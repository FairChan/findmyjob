import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma, type ResumeParseDraft, type ResumeParseState } from '@prisma/client'
import { z } from 'zod'
import { env } from '@/env'
import { getObjectBytes } from '@/lib/storage'
import { db } from '../db'
import type { UserCtx } from '../authz'
import {
  AppError, ConflictError, FeatureDisabledError, ForbiddenError, NotFoundError,
  RateLimitedError, ValidationError, VersionMismatchError,
} from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { logger } from '../lib/logger'
import { checkRateLimit } from '../lib/rate-limit'
import { withResumeTextSlot } from '../lib/resume-text'
import { sendBoss } from '../jobs/boss'
import {
  discardResumeParseSchema, normalizeResumeConfirmation,
  normalizeResumeSuggestion, requestResumeParseSchema, resumeIdSchema, resumeParseConsentSchema,
  resumeParseFailureCodeSchema, resumeParseGateSchema, RESUME_PROMPT_VERSION, RESUME_SCHEMA_VERSION,
  type ConfirmResumeParseInput, type RequestResumeParseInput, type ResumeParseConsentInput,
  type ResumeParseFailureCode, type ResumeParsePatch, type ResumeSuggestionV1,
} from '../schemas/resume-parsing'
import { projectExistingResumeProfile, type ExistingResumeProfileSnapshot } from '../schemas/resume-profile-snapshot'
import { logAudit } from './audit'
import { getSetting } from './settings'
import { recalcCompletenessTx } from './student-profile'
import { qualifyReferral } from './referrals'

const pendingStates: ResumeParseState[] = ['QUEUED', 'PROCESSING', 'READY']
const MAX_RESUME_BYTES = 5 * 1024 * 1024
const QUEUE_TIMEOUT_MS = 2_000

export type ResumeParseAuthorization = {
  consentGrantId: string
  legalVersion: string
  gateEpoch: string
  requestedModel: string
}
export type ResumeParseAccess = {
  profileId: string
  resume: {
    id: string; storageKey: string; contentSha256: string | null
    fileName: string; createdAt: Date; sizeBytes: number
  }
  authorization: ResumeParseAuthorization
}
export type ResumeParseDraftDto = {
  resumeId: string; generation: number; state: ResumeParseState
  payload: ResumeSuggestionV1 | null; profileRevision: number
  currentProfile: ExistingResumeProfileSnapshot | null; failureCode: ResumeParseFailureCode | null
  requestedAt: string; completedAt: string | null; confirmedAt: string | null
  source: { fileName: string; createdAt: string }
}
export type ResumeParseRequestResult = {
  resumeId: string; generation: number; state: ResumeParseState; dispatch: 'pending' | 'submitted'
}
export type ResumeParseUiState = {
  available: boolean
  /** Latest AI record's granted flag, independent of gate/version, so withdrawal stays visible. */
  consentGranted: boolean
  legalVersion: string | null
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ValidationError('Invalid resume parsing input')
  return result.data
}

/** Caller holds STUDENT_DATA(userId). Re-read current role/status, never trust the session alone. */
async function assertStudentTx(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true } })
  if (user?.role !== 'STUDENT' || user.status !== 'ACTIVE') throw new ForbiddenError()
}

async function ownedResumeTx(tx: Prisma.TransactionClient, userId: string, resumeId: string) {
  await assertStudentTx(tx, userId)
  const row = await tx.resumeFile.findFirst({
    where: { id: resumeId, student: { userId } },
    select: {
      id: true, storageKey: true, contentSha256: true, fileName: true, createdAt: true, sizeBytes: true,
      student: { select: { id: true, editRevision: true } },
    },
  })
  if (!row) throw new NotFoundError()
  return row
}

async function currentLegalVersionTx(tx: Prisma.TransactionClient): Promise<string> {
  const version = await getSetting<unknown>('legal.currentVersion', '2026-11-draft', { tx, fresh: true })
  const result = z.string().min(1).max(100).safeParse(version)
  if (!result.success) throw new VersionMismatchError()
  return result.data
}

async function enabledGateTx(tx: Prisma.TransactionClient) {
  const raw = await getSetting<unknown>('ai.resumeParse', null, { tx, fresh: true })
  const gate = resumeParseGateSchema.safeParse(raw)
  if (!gate.success || !gate.data.enabled || !gate.data.legalVersion ||
    !env.ANTHROPIC_API_KEY?.trim() || !env.AI_MODEL_PARSE?.trim() || env.AI_MODEL_PARSE.length > 200) {
    throw new FeatureDisabledError()
  }
  const version = await currentLegalVersionTx(tx)
  if (gate.data.legalVersion !== version) throw new VersionMismatchError()
  return { legalVersion: version, gateEpoch: gate.data.epoch, requestedModel: env.AI_MODEL_PARSE.trim() }
}

async function assertLegalConsentsTx(tx: Prisma.TransactionClient, userId: string, version: string): Promise<void> {
  for (const type of ['TERMS', 'PRIVACY'] as const) {
    const latest = await tx.consent.findFirst({
      where: { userId, type }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    if (!latest?.granted) throw new ForbiddenError('Current legal consent is required')
    if (latest.version !== version) throw new VersionMismatchError()
  }
}

function latestAiConsentTx(tx: Prisma.TransactionClient, userId: string) {
  return tx.consent.findFirst({
    where: { userId, type: 'AI_RESUME_PARSE' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
}

export async function assertResumeParseAuthorizationTx(
  tx: Prisma.TransactionClient, userId: string,
): Promise<ResumeParseAuthorization> {
  await assertStudentTx(tx, userId)
  const gate = await enabledGateTx(tx)
  await assertLegalConsentsTx(tx, userId, gate.legalVersion)
  const grant = await latestAiConsentTx(tx, userId)
  if (!grant?.granted) throw new ForbiddenError('Resume parsing consent is required')
  if (grant.version !== gate.legalVersion) throw new VersionMismatchError()
  return { ...gate, consentGrantId: grant.id }
}

/** Internal worker/request port; caller holds the lifecycle lock and commits before any I/O. */
export async function assertResumeParseAccessTx(
  tx: Prisma.TransactionClient, userId: string, resumeId: string,
): Promise<ResumeParseAccess> {
  const owned = await ownedResumeTx(tx, userId, resumeId)
  const authorization = await assertResumeParseAuthorizationTx(tx, userId)
  return {
    profileId: owned.student.id,
    resume: {
      id: owned.id, storageKey: owned.storageKey, contentSha256: owned.contentSha256,
      fileName: owned.fileName, createdAt: owned.createdAt, sizeBytes: owned.sizeBytes,
    },
    authorization,
  }
}

type ResumeParseSnapshot = Pick<ResumeParseDraft,
  'sourceStorageKey' | 'sourceSha256' | 'consentGrantId' | 'gateEpoch' | 'legalVersion' |
  'schemaVersion' | 'promptVersion' | 'requestedModel'>

export function isResumeParseSnapshotCurrent(draft: ResumeParseSnapshot, access: ResumeParseAccess): boolean {
  return draft.sourceStorageKey === access.resume.storageKey &&
    access.resume.contentSha256 !== null && draft.sourceSha256 === access.resume.contentSha256 &&
    draft.consentGrantId === access.authorization.consentGrantId &&
    draft.gateEpoch === access.authorization.gateEpoch && draft.legalVersion === access.authorization.legalVersion &&
    draft.schemaVersion === RESUME_SCHEMA_VERSION && draft.promptVersion === RESUME_PROMPT_VERSION &&
    draft.requestedModel.trim().length > 0 && draft.requestedModel.length <= 200
}

function cancelledData(failureCode: ResumeParseFailureCode | null): Prisma.ResumeParseDraftUpdateManyMutationInput {
  return {
    state: 'CANCELLED', generation: { increment: 1 }, payload: Prisma.DbNull, failureCode,
    leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null,
    confirmationHash: null, appliedProfileRevision: null, confirmedAt: null, completedAt: new Date(),
  }
}

/** Caller holds STUDENT_DATA(userId); do not throw after this and expect cancellation to survive rollback. */
export async function cancelResumeParseDraftsTx(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const result = await tx.resumeParseDraft.updateMany({
    where: { resume: { student: { userId } }, state: { in: pendingStates } },
    data: cancelledData('AUTHORIZATION_CHANGED'),
  })
  return result.count
}

async function cancelDraftTx(tx: Prisma.TransactionClient, draft: ResumeParseDraft, code: ResumeParseFailureCode) {
  await tx.resumeParseDraft.updateMany({
    where: { id: draft.id, generation: draft.generation, state: { in: pendingStates } },
    data: cancelledData(code),
  })
}

export async function setResumeParseConsent(
  ctx: UserCtx, value: ResumeParseConsentInput,
): Promise<{ granted: boolean; version: string }> {
  const input = parseInput(resumeParseConsentSchema, value)
  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
    await assertStudentTx(tx, ctx.userId)
    const previous = await latestAiConsentTx(tx, ctx.userId)
    const current = await getSetting<unknown>('legal.currentVersion', '2026-11-draft', { tx, fresh: true })
    const parsedVersion = z.string().min(1).max(100).safeParse(current)
    // Withdrawal remains available even when an administrator has invalidated the gate/legal setting.
    const version = parsedVersion.success ? parsedVersion.data : previous?.version ?? '2026-11-draft'
    if (input.granted) {
      const gate = await enabledGateTx(tx)
      if (input.submittedVersion !== gate.legalVersion) throw new VersionMismatchError()
      await assertLegalConsentsTx(tx, ctx.userId, version)
      if (previous?.granted && previous.version === version) return { granted: true, version }
    }
    // Database time plus monotonic per-user ordering prevents same-millisecond revoke/regrant ambiguity.
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS "now"`
    if (!clock) throw new AppError('Consent clock unavailable', 'INTERNAL_ERROR', 500)
    const createdAt = new Date(Math.max(clock.now.getTime(), (previous?.createdAt.getTime() ?? 0) + 1))
    await tx.consent.create({
      data: { userId: ctx.userId, type: 'AI_RESUME_PARSE', version, granted: input.granted, createdAt },
    })
    if (!input.granted) await cancelResumeParseDraftsTx(tx, ctx.userId)
    await logAudit({
      actorId: ctx.userId, action: 'resume.parse.consent', targetType: 'User', targetId: ctx.userId,
      metadata: { granted: input.granted, version },
    }, tx)
    return { granted: input.granted, version }
  })
}

/** Server page bootstrap only; draft data is read through the owner-scoped action. */
export async function getResumeParseUiState(ctx: UserCtx): Promise<ResumeParseUiState> {
  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
    await assertStudentTx(tx, ctx.userId)
    const latest = await latestAiConsentTx(tx, ctx.userId)
    const rawVersion = await getSetting<unknown>('legal.currentVersion', null, { tx, fresh: true })
    const version = z.string().min(1).max(100).safeParse(rawVersion)
    let available = false
    let legalVersion: string | null = version.success ? version.data : null
    try {
      const gate = await enabledGateTx(tx)
      await assertLegalConsentsTx(tx, ctx.userId, gate.legalVersion)
      available = true
      legalVersion = gate.legalVersion
    } catch (error) { if (!(error instanceof AppError)) throw error }
    return { available, consentGranted: latest?.granted === true, legalVersion }
  })
}

type RequestDecision =
  | { kind: 'error'; error: AppError }
  | { kind: 'hash'; access: ResumeParseAccess }
  | { kind: 'result'; result: Omit<ResumeParseRequestResult, 'dispatch'>; send: boolean }

async function decideRequestTx(
  tx: Prisma.TransactionClient, ctx: UserCtx, input: RequestResumeParseInput,
  prepared?: { access: ResumeParseAccess; hash: string },
): Promise<RequestDecision> {
  await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
  const owned = await ownedResumeTx(tx, ctx.userId, input.resumeId)
  const draft = await tx.resumeParseDraft.findUnique({ where: { resumeId: owned.id } })
  let access: ResumeParseAccess
  try { access = await assertResumeParseAccessTx(tx, ctx.userId, input.resumeId) } catch (error) {
    if (!(error instanceof AppError)) throw error
    if (draft && pendingStates.includes(draft.state)) await cancelDraftTx(tx, draft, 'AUTHORIZATION_CHANGED')
    return { kind: 'error', error }
  }
  if (prepared) {
    if (access.resume.storageKey !== prepared.access.resume.storageKey ||
      access.profileId !== prepared.access.profileId ||
      access.authorization.consentGrantId !== prepared.access.authorization.consentGrantId ||
      access.authorization.gateEpoch !== prepared.access.authorization.gateEpoch ||
      access.authorization.legalVersion !== prepared.access.authorization.legalVersion) {
      if (draft) await cancelDraftTx(tx, draft, 'AUTHORIZATION_CHANGED')
      return { kind: 'error', error: new ConflictError() }
    }
    if (access.resume.contentSha256 === null) {
      await tx.resumeFile.updateMany({
        where: { id: owned.id, studentId: access.profileId, storageKey: access.resume.storageKey, contentSha256: null },
        data: { contentSha256: prepared.hash },
      })
      const refreshed = await ownedResumeTx(tx, ctx.userId, owned.id)
      access.resume.contentSha256 = refreshed.contentSha256
    }
    if (access.resume.contentSha256 !== prepared.hash) {
      if (draft) await cancelDraftTx(tx, draft, 'SOURCE_CHANGED')
      return { kind: 'error', error: new ConflictError() }
    }
  }
  if (draft && pendingStates.includes(draft.state)) {
    if (!isResumeParseSnapshotCurrent(draft, access)) {
      const sourceChanged = draft.sourceStorageKey !== access.resume.storageKey ||
        draft.sourceSha256 !== access.resume.contentSha256
      await cancelDraftTx(tx, draft, sourceChanged ? 'SOURCE_CHANGED' : 'AUTHORIZATION_CHANGED')
      return { kind: 'error', error: new ConflictError() }
    }
    if (input.expectedGeneration !== undefined && input.expectedGeneration !== draft.generation) {
      return { kind: 'error', error: new ConflictError() }
    }
    return {
      kind: 'result', result: { resumeId: owned.id, generation: draft.generation, state: draft.state },
      send: draft.state === 'QUEUED',
    }
  }
  if (draft && (draft.state === 'CONFIRMED' || input.expectedGeneration !== draft.generation)) {
    return { kind: 'error', error: new ConflictError('Discard or reload this resume draft first') }
  }
  if (!draft && input.expectedGeneration !== undefined) return { kind: 'error', error: new ConflictError() }
  if (access.resume.sizeBytes <= 0 || access.resume.sizeBytes > MAX_RESUME_BYTES) {
    return { kind: 'error', error: new ValidationError('Invalid resume source size') }
  }
  const rawQuota = await getSetting<unknown>('limits.resumeParsesPerHour', 3, { tx, fresh: true })
  const quota = z.number().int().min(0).max(100).safeParse(rawQuota)
  if (!quota.success) return { kind: 'error', error: new FeatureDisabledError() }
  if (quota.data === 0) return { kind: 'error', error: new RateLimitedError() }
  if (access.resume.contentSha256 === null) return { kind: 'hash', access }
  if (!/^[a-f0-9]{64}$/.test(access.resume.contentSha256)) {
    return { kind: 'error', error: new ConflictError('Invalid resume source hash') }
  }
  const rate = await checkRateLimit(`resume-parse:${ctx.userId}`, { windowMs: 3_600_000, limit: quota.data })
  if (!rate.allowed) return { kind: 'error', error: new RateLimitedError() }
  const generation = (draft?.generation ?? 0) + 1
  const data = {
    generation, state: 'QUEUED' as const, sourceStorageKey: access.resume.storageKey,
    sourceSha256: access.resume.contentSha256, ...access.authorization,
    schemaVersion: RESUME_SCHEMA_VERSION, promptVersion: RESUME_PROMPT_VERSION,
    responseModel: null, payload: Prisma.DbNull, failureCode: null, attempts: 0,
    nextAttemptAt: null, leaseExpiresAt: null, leaseToken: null,
    confirmationHash: null, appliedProfileRevision: null, requestedAt: new Date(), completedAt: null, confirmedAt: null,
  }
  if (draft) {
    const updated = await tx.resumeParseDraft.updateMany({
      where: { id: draft.id, generation: draft.generation, state: { in: ['FAILED', 'CANCELLED'] } }, data,
    })
    if (updated.count !== 1) throw new ConflictError()
  } else {
    await tx.resumeParseDraft.create({ data: { resumeId: owned.id, ...data } })
  }
  return { kind: 'result', result: { resumeId: owned.id, generation, state: 'QUEUED' }, send: true }
}

/** Bounded response latency; pg-boss work is observed even if it settles after our deadline. */
async function submitParse(resumeId: string, generation: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = Date.now() + QUEUE_TIMEOUT_MS
  const attempt = (async () => {
    await sendBoss.start()
    if (Date.now() >= deadline) return false
    const jobId = await sendBoss.send('resume-parse', { resumeId, generation })
    return typeof jobId === 'string' && jobId.length > 0
  })().catch(() => false)
  try {
    const submitted = await Promise.race([
      attempt,
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), QUEUE_TIMEOUT_MS) }),
    ])
    if (!submitted) logger.warn({ event: 'resume_parse_dispatch_pending' }, 'Resume parse dispatch pending')
    return submitted
  } finally { if (timer) clearTimeout(timer) }
}

export async function requestResumeParse(ctx: UserCtx, value: RequestResumeParseInput): Promise<ResumeParseRequestResult> {
  const input = parseInput(requestResumeParseSchema, value)
  let decision = await db.$transaction(tx => decideRequestTx(tx, ctx, input))
  if (decision.kind === 'hash') {
    const access = decision.access
    let hash: string
    try {
      const signal = AbortSignal.timeout(15_000)
      hash = await withResumeTextSlot(async (slotSignal: AbortSignal) => {
        // Admission can wait; authorize again under a short lock, then commit before S3.
        await db.$transaction(async tx => {
          await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
          const current = await assertResumeParseAccessTx(tx, ctx.userId, input.resumeId)
          if (current.resume.id !== access.resume.id || current.resume.storageKey !== access.resume.storageKey ||
            current.resume.sizeBytes !== access.resume.sizeBytes ||
            current.profileId !== access.profileId ||
            current.authorization.consentGrantId !== access.authorization.consentGrantId ||
            current.authorization.gateEpoch !== access.authorization.gateEpoch ||
            current.authorization.legalVersion !== access.authorization.legalVersion) throw new ConflictError()
        })
        // Another request may initialize a legacy hash; decideRequestTx verifies it against these bytes.
        const bytes = await getObjectBytes(access.resume.storageKey, { maxBytes: MAX_RESUME_BYTES, signal: slotSignal })
        if (bytes.length === 0 || bytes.length !== access.resume.sizeBytes) throw new Error('Invalid source size')
        return createHash('sha256').update(bytes).digest('hex')
      }, { signal })
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('Resume source is unavailable', 'SOURCE_MISSING', 503)
    }
    decision = await db.$transaction(tx => decideRequestTx(tx, ctx, input, { access, hash }))
  }
  if (decision.kind === 'error') throw decision.error // Cancellation has already committed.
  if (decision.kind !== 'result') throw new ConflictError()
  const submitted = decision.send ? await submitParse(decision.result.resumeId, decision.result.generation) : true
  return { ...decision.result, dispatch: submitted ? 'submitted' : 'pending' }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function replaceSelectedCollectionsTx(tx: Prisma.TransactionClient, profileId: string, patch: ResumeParsePatch) {
  if (patch.languages !== undefined) {
    await tx.studentLanguage.deleteMany({ where: { studentId: profileId } })
    if (patch.languages.length) await tx.studentLanguage.createMany({
      data: patch.languages.map(item => ({ studentId: profileId, language: item.language, level: item.level })),
    })
  }
  if (patch.educations !== undefined) {
    await tx.education.deleteMany({ where: { studentId: profileId } })
    if (patch.educations.length) await tx.education.createMany({
      data: patch.educations.map((item, sortOrder) => ({
        studentId: profileId, schoolName: item.schoolName, degreeLevel: item.degreeLevel, major: item.major,
        startDate: item.startDate === null ? null : new Date(item.startDate),
        endDate: item.endDate === null ? null : new Date(item.endDate),
        gpa: item.gpa, description: item.description, sortOrder,
      })),
    })
  }
  if (patch.experiences !== undefined) {
    await tx.experience.deleteMany({ where: { studentId: profileId } })
    if (patch.experiences.length) await tx.experience.createMany({
      data: patch.experiences.map((item, sortOrder) => ({
        studentId: profileId, kind: item.kind, title: item.title, organization: item.organization,
        startDate: item.startDate === null ? null : new Date(item.startDate),
        endDate: item.endDate === null ? null : new Date(item.endDate), description: item.description, sortOrder,
      })),
    })
  }
}

export async function confirmResumeParse(
  ctx: UserCtx, value: ConfirmResumeParseInput,
): Promise<{ appliedProfileRevision: number; alreadyApplied: boolean }> {
  let input: ReturnType<typeof normalizeResumeConfirmation>
  try { input = normalizeResumeConfirmation(value) } catch { throw new ValidationError('Invalid resume confirmation') }
  const hash = createHash('sha256').update(canonicalJson(input.patch)).digest('hex')
  const result = await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
    const owned = await ownedResumeTx(tx, ctx.userId, input.resumeId)
    const draft = await tx.resumeParseDraft.findUnique({ where: { resumeId: owned.id } })
    if (!draft || draft.generation !== input.generation) throw new ConflictError()
    if (draft.sourceStorageKey !== owned.storageKey || draft.sourceSha256 !== owned.contentSha256 ||
      draft.schemaVersion !== RESUME_SCHEMA_VERSION || draft.promptVersion !== RESUME_PROMPT_VERSION) {
      throw new ConflictError()
    }
    if (draft.state === 'CONFIRMED') {
      if (draft.confirmationHash !== hash || draft.appliedProfileRevision === null) throw new ConflictError()
      return { appliedProfileRevision: draft.appliedProfileRevision, alreadyApplied: true, profileId: owned.student.id }
    }
    if (draft.state !== 'READY') throw new ConflictError()
    const access = await assertResumeParseAccessTx(tx, ctx.userId, input.resumeId)
    if (!isResumeParseSnapshotCurrent(draft, access)) throw new ConflictError()
    if (owned.student.editRevision !== input.expectedProfileRevision) throw new ConflictError()
    const patch = input.patch
    const changed = await tx.studentProfile.updateMany({
      where: { id: owned.student.id, editRevision: input.expectedProfileRevision },
      data: {
        ...(patch.headline !== undefined ? { headline: patch.headline } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.skills !== undefined ? { skills: patch.skills } : {}), editRevision: { increment: 1 },
      },
    })
    if (changed.count !== 1) throw new ConflictError()
    await replaceSelectedCollectionsTx(tx, owned.student.id, patch)
    await recalcCompletenessTx(tx, owned.student.id)
    const appliedProfileRevision = input.expectedProfileRevision + 1
    const confirmed = await tx.resumeParseDraft.updateMany({
      where: { id: draft.id, generation: input.generation, state: 'READY' },
      data: {
        state: 'CONFIRMED', payload: Prisma.DbNull, leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null,
        confirmationHash: hash, appliedProfileRevision, confirmedAt: new Date(), failureCode: null,
      },
    })
    if (confirmed.count !== 1) throw new ConflictError()
    await logAudit({
      actorId: ctx.userId, action: 'resume.parse.confirm', targetType: 'ResumeFile', targetId: owned.id,
      metadata: {
        resumeId: owned.id, generation: input.generation, fields: Object.keys(patch).filter(key => patch[key as keyof ResumeParsePatch] !== undefined).sort(),
        collectionCounts: {
          ...(patch.languages !== undefined ? { languages: patch.languages.length } : {}),
          ...(patch.educations !== undefined ? { educations: patch.educations.length } : {}),
          ...(patch.experiences !== undefined ? { experiences: patch.experiences.length } : {}),
        }, schemaVersion: RESUME_SCHEMA_VERSION, appliedProfileRevision,
      },
    }, tx)
    return { appliedProfileRevision, alreadyApplied: false, profileId: owned.student.id }
  })
  if (!result.alreadyApplied) {
    try { await qualifyReferral(result.profileId) } catch {
      logger.warn({ event: 'resume_parse_referral_deferred' }, 'Resume parse referral check deferred')
    }
  }
  return { appliedProfileRevision: result.appliedProfileRevision, alreadyApplied: result.alreadyApplied }
}

export async function discardResumeParseDraft(ctx: UserCtx, value: { resumeId: string; generation: number }): Promise<void> {
  const input = parseInput(discardResumeParseSchema, value)
  await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
    const owned = await ownedResumeTx(tx, ctx.userId, input.resumeId)
    const result = await tx.resumeParseDraft.updateMany({
      where: { resumeId: owned.id, generation: input.generation }, data: cancelledData(null),
    })
    if (result.count !== 1) throw new ConflictError()
    await logAudit({
      actorId: ctx.userId, action: 'resume.parse.discard', targetType: 'ResumeFile', targetId: owned.id,
      metadata: { generation: input.generation },
    }, tx)
  })
}

export async function getResumeParseDraft(ctx: UserCtx, value: { resumeId: string }): Promise<ResumeParseDraftDto | null> {
  const input = parseInput(resumeIdSchema, value)
  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
    const owned = await ownedResumeTx(tx, ctx.userId, input.resumeId)
    const draft = await tx.resumeParseDraft.findUnique({ where: { resumeId: owned.id } })
    if (!draft) return null
    let payload: ResumeSuggestionV1 | null = null
    let currentProfile: ExistingResumeProfileSnapshot | null = null
    if (draft.state === 'READY') {
      try { payload = normalizeResumeSuggestion(draft.payload) } catch { /* Corrupt data is not exposed. */ }
      const profile = await tx.studentProfile.findUniqueOrThrow({
        where: { id: owned.student.id }, select: {
          headline: true, summary: true, skills: true,
          languages: { select: { language: true, level: true }, orderBy: [{ language: 'asc' }, { id: 'asc' }] },
          educations: { select: {
            schoolName: true, degreeLevel: true, major: true, startDate: true, endDate: true, gpa: true, description: true,
          }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
          experiences: { select: {
            kind: true, title: true, organization: true, startDate: true, endDate: true, description: true,
          }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        },
      })
      currentProfile = projectExistingResumeProfile({
        ...profile,
        educations: profile.educations.map(item => ({ ...item, startDate: item.startDate?.toISOString() ?? null, endDate: item.endDate?.toISOString() ?? null })),
        experiences: profile.experiences.map(item => ({ ...item, startDate: item.startDate?.toISOString() ?? null, endDate: item.endDate?.toISOString() ?? null })),
      })
    }
    const failure = resumeParseFailureCodeSchema.safeParse(draft.failureCode)
    return {
      resumeId: owned.id, generation: draft.generation, state: draft.state, payload,
      profileRevision: owned.student.editRevision, currentProfile, failureCode: failure.success ? failure.data : null,
      requestedAt: draft.requestedAt.toISOString(), completedAt: draft.completedAt?.toISOString() ?? null,
      confirmedAt: draft.confirmedAt?.toISOString() ?? null,
      source: { fileName: owned.fileName, createdAt: owned.createdAt.toISOString() },
    }
  })
}

/** No new outbox: existing QUEUED and expired PROCESSING rows are the durable recovery source. */
export async function dispatchPendingResumeParses(): Promise<void> {
  const now = new Date()
  const pending = await db.resumeParseDraft.findMany({
    where: { OR: [
      { state: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      { state: 'PROCESSING', leaseExpiresAt: { lte: now } },
    ] },
    select: { resumeId: true, generation: true }, orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }], take: 50,
  })
  for (const row of pending) {
    if (!await submitParse(row.resumeId, row.generation)) break
  }
}
