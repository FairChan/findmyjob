import 'server-only'
import { Prisma, type SemanticIndex } from '@prisma/client'
import { z } from 'zod'
import { embeddingVectorSchema, matchingConsentSchema, recommendJobsSchema, recommendTalentsSchema } from '@/schemas/semantic-matching'
import { db } from '../db'
import { AppError, ConflictError, FeatureDisabledError, ForbiddenError, NotFoundError, RateLimitedError, ValidationError, VersionMismatchError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { logger } from '../lib/logger'
import { checkRateLimit } from '../lib/rate-limit'
import { buildJobMatchingText, buildStudentMatchingText, type MatchingText } from '../lib/matching-text'
import { getMatchingConfiguration, sameMatchingConfiguration, type MatchingConfiguration } from '../lib/matching-config'
import { embedMatchingText } from '../lib/ai/embedding-provider'
import { deleteSemanticVector, findJobNeighbors, findTalentNeighbors, isSemanticStoreAvailable, type SemanticNeighbor } from '../lib/semantic-store'
import { sendBoss } from '../jobs/boss'
import { toTalentCard, type TalentCard } from '../serializers/talent-card'
import { toJobListItem, type JobListItem } from '../serializers/job'
import { canSeeIdentityMany } from './contact-access'
import { isStudentVisibleToCompany } from './talent-visibility'
import { getSetting } from './settings'
import { logAudit } from './audit'

export type MatchingConsentInput = z.input<typeof matchingConsentSchema>
export type StudentMatchingUiState = { available: boolean; consentGranted: boolean; consentCurrent: boolean; legalVersion: string | null }
export type MatchingResult<T> = { items: T[]; availability: 'ready' | 'unavailable' }
export type MatchingFailureCode = 'AUTHORIZATION_CHANGED' | 'SOURCE_CHANGED' | 'CONFIGURATION_CHANGED' |
  'SOURCE_UNAVAILABLE' | 'STORE_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAVAILABLE' |
  'OUTPUT_INVALID' | 'ATTEMPTS_EXHAUSTED' | 'QUEUE_UNAVAILABLE'
export type MatchingSourceSnapshot = {
  kind: 'STUDENT' | 'JOB'; subjectId: string; userId: string | null
  source: MatchingText; sourceRevision: number; consentGrantId: string | null; config: MatchingConfiguration
}
type StudentCtx = { userId: string }
type EmployerCtx = { userId: string; companyId: string }
type QuerySnapshot = MatchingSourceSnapshot & { termsId: string; privacyId: string; memberId: string | null }
const unavailable = <T>(): MatchingResult<T> => ({ items: [], availability: 'unavailable' })
const studentProjectionSelect = {
  id: true, userId: true, fullName: true, headline: true, major: true, degreeLevel: true,
  skills: true, intents: true, preferredStates: true, editRevision: true,
  visibility: true, completeness: true, schoolVerifiedAt: true,
  user: { select: { status: true, role: true } },
} satisfies Prisma.StudentProfileSelect
const jobProjectionSelect = {
  id: true, companyId: true, title: true, type: true, category: true, workMode: true,
  state: true, city: true, skills: true, languages: true, matchingRevision: true,
  status: true, deadline: true, company: { select: { isActive: true } },
} satisfies Prisma.JobSelect
const profileCardSelect = {
  ...studentProjectionSelect, graduationYear: true, cgpa: true, workAuth: true, lastActiveAt: true,
  school: { select: { id: true, nameZh: true, nameEn: true } },
} satisfies Prisma.StudentProfileSelect
const jobListSelect = {
  ...jobProjectionSelect, salaryMin: true, salaryMax: true, salaryVisible: true,
  acceptsStudentPass: true, sponsorsWorkPass: true, headcount: true, publishedAt: true,
  company: { select: { id: true, isActive: true, displayNameZh: true, displayNameEn: true, legalName: true } },
} satisfies Prisma.JobSelect

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) throw new ValidationError('Invalid matching input')
  return result.data
}
async function assertStudentTx(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true } })
  if (user?.role !== 'STUDENT' || user.status !== 'ACTIVE') throw new ForbiddenError()
}
async function studentRowTx(tx: Prisma.TransactionClient, userId: string) {
  await assertStudentTx(tx, userId)
  const profile = await tx.studentProfile.findUnique({ where: { userId }, select: studentProjectionSelect })
  if (!profile) throw new NotFoundError()
  return profile
}
async function assertEmployerTx(tx: Prisma.TransactionClient, ctx: EmployerCtx): Promise<string> {
  const member = await tx.companyMember.findUnique({
    where: { companyId_userId: { companyId: ctx.companyId, userId: ctx.userId } },
    select: { id: true, role: true, user: { select: { role: true, status: true } }, company: { select: { isActive: true, verificationStatus: true } } },
  })
  if (!member || member.user.role !== 'EMPLOYER' || member.user.status !== 'ACTIVE' ||
    !member.company.isActive || member.company.verificationStatus !== 'VERIFIED' ||
    !(['OWNER', 'ADMIN', 'RECRUITER'] as const).includes(member.role)) throw new ForbiddenError()
  return member.id
}
function publicJob(row: { status: string; deadline: Date | null; company: { isActive: boolean } }): boolean {
  return row.status === 'PUBLISHED' && row.company.isActive && (row.deadline === null || row.deadline.getTime() > Date.now())
}
async function legalTx(tx: Prisma.TransactionClient, userId: string, version: string) {
  const [terms, privacy] = await Promise.all((['TERMS', 'PRIVACY'] as const).map(type => tx.consent.findFirst({
    where: { userId, type }, select: { id: true, granted: true, version: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })))
  if (!terms?.granted || !privacy?.granted) throw new ForbiddenError('Current legal consent is required')
  if (terms.version !== version || privacy.version !== version) throw new VersionMismatchError()
  return { termsId: terms.id, privacyId: privacy.id }
}
function latestMatchingConsentTx(tx: Prisma.TransactionClient, userId: string) {
  return tx.consent.findFirst({ where: { userId, type: 'AI_MATCHING' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
}
async function matchingGrantTx(tx: Prisma.TransactionClient, userId: string, version: string): Promise<string> {
  const consent = await latestMatchingConsentTx(tx, userId)
  if (!consent?.granted) throw new ForbiddenError('Matching consent is required')
  if (consent.version !== version) throw new VersionMismatchError()
  return consent.id
}
async function eligibleStudentTx(
  tx: Prisma.TransactionClient, profile: Awaited<ReturnType<typeof studentRowTx>>,
): Promise<boolean> {
  const min = z.number().int().min(0).max(100).safeParse(await getSetting<unknown>('talentPool.minCompleteness', 60, { tx, fresh: true }))
  return min.success && profile.visibility === 'PUBLIC' && profile.schoolVerifiedAt !== null && profile.completeness >= min.data &&
    profile.user.role === 'STUDENT' && profile.user.status === 'ACTIVE'
}
async function assertTalentSearchTx(tx: Prisma.TransactionClient): Promise<void> {
  if (await getSetting<unknown>('talentPool.searchEnabled', true, { tx, fresh: true }) !== true) throw new FeatureDisabledError()
}

async function studentQueryTx(tx: Prisma.TransactionClient, userId: string, indexOnly = false): Promise<QuerySnapshot | null> {
  await lockXact(tx, LOCK_NS.STUDENT_DATA, userId)
  const profile = await studentRowTx(tx, userId)
  const config = await getMatchingConfiguration(tx)
  if (!config) return null
  const legal = await legalTx(tx, userId, config.legalVersion)
  const consentGrantId = await matchingGrantTx(tx, userId, config.legalVersion)
  if (indexOnly && !await eligibleStudentTx(tx, profile)) throw new ForbiddenError()
  const source = buildStudentMatchingText(profile)
  if (!source) return null
  return { kind: 'STUDENT', subjectId: profile.id, userId, source, sourceRevision: profile.editRevision,
    consentGrantId, config, ...legal, memberId: null }
}
async function talentQueryTx(tx: Prisma.TransactionClient, ctx: EmployerCtx, jobId: string): Promise<QuerySnapshot | null> {
  const memberId = await assertEmployerTx(tx, ctx)
  const job = await tx.job.findFirst({ where: { id: jobId, companyId: ctx.companyId }, select: jobProjectionSelect })
  if (!job || !publicJob(job)) throw new NotFoundError()
  await assertTalentSearchTx(tx)
  const config = await getMatchingConfiguration(tx)
  if (!config) return null
  const legal = await legalTx(tx, ctx.userId, config.legalVersion)
  return { kind: 'JOB', subjectId: job.id, userId: ctx.userId, source: buildJobMatchingText(job),
    sourceRevision: job.matchingRevision, consentGrantId: null, config, ...legal, memberId }
}
function sameQuery(before: QuerySnapshot, after: QuerySnapshot | null): void {
  if (!after || before.subjectId !== after.subjectId || before.source.sourceHash !== after.source.sourceHash ||
    before.sourceRevision !== after.sourceRevision || before.consentGrantId !== after.consentGrantId ||
    before.memberId !== after.memberId || before.termsId !== after.termsId || before.privacyId !== after.privacyId ||
    !sameMatchingConfiguration(before.config, after.config)) throw new ConflictError('Matching request changed')
}
async function recheckQuery(before: QuerySnapshot, reload: (tx: Prisma.TransactionClient) => Promise<QuerySnapshot | null>): Promise<void> {
  try { await db.$transaction(async tx => { sameQuery(before, await reload(tx)) }) }
  catch (error) {
    if (error instanceof NotFoundError || error instanceof VersionMismatchError || error instanceof FeatureDisabledError) throw new ConflictError('Matching request changed')
    throw error
  }
}

export async function getStudentMatchingUiState(ctx: StudentCtx): Promise<StudentMatchingUiState> {
  const state = await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
    await assertStudentTx(tx, ctx.userId)
    const [rawVersion, latest, config] = await Promise.all([
      getSetting<unknown>('legal.currentVersion', '2026-11-draft', { tx, fresh: true }), latestMatchingConsentTx(tx, ctx.userId), getMatchingConfiguration(tx),
    ])
    const version = z.string().min(1).max(100).safeParse(rawVersion)
    let legalCurrent = false
    if (version.success) {
      try { await legalTx(tx, ctx.userId, version.data); legalCurrent = true }
      catch (error) { if (!(error instanceof AppError)) throw error }
    }
    return { available: config !== null && legalCurrent, consentGranted: latest?.granted === true,
      consentCurrent: legalCurrent && latest?.granted === true && latest.version === (version.success ? version.data : null),
      legalVersion: version.success ? version.data : null }
  })
  return { ...state, available: state.available && await isSemanticStoreAvailable() }
}

function cancellationData(code: MatchingFailureCode): Prisma.SemanticIndexUpdateManyMutationInput {
  return { state: 'CANCELLED', generation: { increment: 1 }, failureCode: code, leaseToken: null,
    leaseExpiresAt: null, nextAttemptAt: null, completedAt: new Date() }
}
/** Parent mutation holds STUDENT_DATA(userId) and increments editRevision once in its existing save. */
export async function invalidateStudentMatchingIndexTx(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.semanticIndex.updateMany({ where: { student: { userId } }, data: cancellationData('SOURCE_CHANGED') })
}
/** Parent mutation already holds the Job row lock; increment matchingRevision in that same transaction. */
export async function invalidateJobMatchingIndexTx(tx: Prisma.TransactionClient, jobId: string): Promise<void> {
  await tx.semanticIndex.updateMany({ where: { jobId }, data: cancellationData('SOURCE_CHANGED') })
}
const CLEANUP_PROBE_MS = 24 * 60 * 60 * 1000
const CLEANUP_RETRY_MS = 5 * 60 * 1000

async function scheduleCleanupProbeTx(
  tx: Prisma.TransactionClient, cancelled: { indexId: string; generation: number }, delay: number,
): Promise<void> {
  await tx.semanticIndex.updateMany({
    where: { id: cancelled.indexId, state: 'CANCELLED', generation: cancelled.generation },
    // For CANCELLED only, this is the next physical probe, never a completion marker.
    data: { nextAttemptAt: new Date(Date.now() + delay) },
  })
}
async function cleanupVector(cancelled: { indexId: string; generation: number }): Promise<void> {
  try { await db.$transaction(async tx => {
    const current = await lockMatchingIndexTx(tx, cancelled.indexId)
    if (current?.state !== 'CANCELLED' || current.generation !== cancelled.generation) return
    if (!await isSemanticStoreAvailable(tx)) return
    await deleteSemanticVector(tx, current.id)
    await scheduleCleanupProbeTx(tx, cancelled, CLEANUP_PROBE_MS)
  }) }
  catch {
    // The failed delete transaction rolled back. Persist retry rotation separately,
    // reacquiring source then metadata and checking the exact cancelled generation.
    try { await db.$transaction(async tx => {
      const current = await lockMatchingIndexTx(tx, cancelled.indexId)
      if (current?.state === 'CANCELLED' && current.generation === cancelled.generation) {
        await scheduleCleanupProbeTx(tx, cancelled, CLEANUP_RETRY_MS)
      }
    }) } catch { /* A DB outage leaves the cancelled generation pending, never completed. */ }
    logger.warn({ event: 'matching_vector_cleanup_deferred' }, 'Matching vector cleanup deferred')
  }
}

export async function setMatchingConsent(ctx: StudentCtx, raw: MatchingConsentInput): Promise<void> {
  const input = parse(matchingConsentSchema, raw)
  const cancelledId = await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
    await assertStudentTx(tx, ctx.userId)
    const latest = await latestMatchingConsentTx(tx, ctx.userId)
    const rawVersion = await getSetting<unknown>('legal.currentVersion', '2026-11-draft', { tx, fresh: true })
    const parsedVersion = z.string().min(1).max(100).safeParse(rawVersion)
    const version = parsedVersion.success ? parsedVersion.data : latest?.version ?? '2026-11-draft'
    if (input.granted) {
      const config = await getMatchingConfiguration(tx)
      if (!config) throw new FeatureDisabledError()
      if (input.submittedVersion !== config.legalVersion) throw new VersionMismatchError()
      await legalTx(tx, ctx.userId, config.legalVersion)
      if (latest?.granted && latest.version === config.legalVersion) return null
    }
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`
    if (!clock) throw new AppError('Consent clock unavailable', 'INTERNAL_ERROR', 500)
    await tx.consent.create({ data: { userId: ctx.userId, type: 'AI_MATCHING', granted: input.granted, version,
      createdAt: new Date(Math.max(clock.now.getTime(), (latest?.createdAt.getTime() ?? 0) + 1)) } })
    let cancelled: { indexId: string; generation: number } | null = null
    if (!input.granted) {
      await tx.semanticIndex.updateMany({ where: { student: { userId: ctx.userId } }, data: cancellationData('AUTHORIZATION_CHANGED') })
      const index = await tx.semanticIndex.findFirst({ where: { student: { userId: ctx.userId } }, select: { id: true, generation: true } })
      cancelled = index ? { indexId: index.id, generation: index.generation } : null
    }
    await logAudit({ actorId: ctx.userId, action: 'matching.consent', targetType: 'User', targetId: ctx.userId,
      metadata: { granted: input.granted, version } }, tx)
    return cancelled
  })
  if (cancelledId) await cleanupVector(cancelledId)
}

/** Shared worker port; all callers obey source lock -> metadata row lock order. */
export async function lockMatchingIndexTx(tx: Prisma.TransactionClient, indexId: string): Promise<SemanticIndex | null> {
  const owner = await tx.semanticIndex.findUnique({ where: { id: indexId }, select: { studentId: true, jobId: true } })
  if (!owner) return null
  if (owner.studentId) {
    const profile = await tx.studentProfile.findUnique({ where: { id: owner.studentId }, select: { userId: true } })
    if (!profile) return null
    await lockXact(tx, LOCK_NS.STUDENT_DATA, profile.userId)
  } else if (owner.jobId) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Job" WHERE id=${owner.jobId} FOR UPDATE`)
  } else return null
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "SemanticIndex" WHERE id=${indexId} FOR UPDATE`)
  return tx.semanticIndex.findUnique({ where: { id: indexId } })
}

export async function loadMatchingIndexSourceTx(tx: Prisma.TransactionClient, index: SemanticIndex): Promise<MatchingSourceSnapshot | null> {
  if (index.kind === 'STUDENT' && index.studentId && !index.jobId) {
    const profile = await tx.studentProfile.findUnique({ where: { id: index.studentId }, select: { userId: true } })
    if (!profile) return null
    return studentQueryTx(tx, profile.userId, true)
  }
  if (index.kind === 'JOB' && index.jobId && !index.studentId) return jobIndexSourceTx(tx, index.jobId)
  return null
}
async function jobIndexSourceTx(tx: Prisma.TransactionClient, jobId: string): Promise<MatchingSourceSnapshot | null> {
  const job = await tx.job.findUnique({ where: { id: jobId }, select: jobProjectionSelect })
  if (!job || !publicJob(job)) return null
  const config = await getMatchingConfiguration(tx)
  if (!config) return null
  return { kind: 'JOB', subjectId: job.id, userId: null, source: buildJobMatchingText(job),
    sourceRevision: job.matchingRevision, consentGrantId: null, config }
}
export function matchingIndexIsCurrent(index: SemanticIndex, source: MatchingSourceSnapshot): boolean {
  return index.kind === source.kind && (index.studentId ?? index.jobId) === source.subjectId &&
    index.sourceHash === source.source.sourceHash && index.sourceRevision === source.sourceRevision &&
    index.consentGrantId === source.consentGrantId && index.configurationId === source.config.configurationId &&
    index.model === source.config.model && index.gateEpoch === source.config.gateEpoch && index.legalVersion === source.config.legalVersion
}

async function submitIndex(indexId: string, generation: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = Date.now() + 2000
  const attempt = (async () => {
    await sendBoss.start()
    if (Date.now() >= deadline) return false
    const id = await sendBoss.send('matching-index', { indexId, generation })
    return typeof id === 'string' && id.length > 0
  })().catch(() => false)
  try {
    const sent = await Promise.race([attempt, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 2000) })])
    if (!sent) logger.warn({ event: 'matching_dispatch_pending' }, 'Matching dispatch pending')
    return sent
  } finally { if (timer) clearTimeout(timer) }
}

async function requestIndexTx(tx: Prisma.TransactionClient, source: MatchingSourceSnapshot, automatic = false) {
  const existing = await tx.semanticIndex.findUnique({
    where: source.kind === 'STUDENT' ? { studentId: source.subjectId } : { jobId: source.subjectId },
  })
  // A terminal failure is retried only by an explicit request or a new source/config/grant.
  if (existing && (['QUEUED', 'PROCESSING', 'READY'].includes(existing.state) || automatic && existing.state === 'FAILED') && matchingIndexIsCurrent(existing, source)) {
    return { indexId: existing.id, generation: existing.generation, send: existing.state === 'QUEUED', queued: false }
  }
  const data = {
    generation: (existing?.generation ?? 0) + 1, state: 'QUEUED' as const,
    sourceHash: source.source.sourceHash, sourceRevision: source.sourceRevision,
    configurationId: source.config.configurationId, model: source.config.model,
    gateEpoch: source.config.gateEpoch, legalVersion: source.config.legalVersion, consentGrantId: source.consentGrantId,
    attempts: 0, failureCode: null, leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null, requestedAt: new Date(), completedAt: null,
  }
  let indexId: string
  if (existing) {
    const updated = await tx.semanticIndex.updateMany({ where: { id: existing.id, generation: existing.generation }, data })
    if (updated.count !== 1) throw new ConflictError()
    indexId = existing.id
  } else {
    const row = await tx.semanticIndex.create({ data: {
      ...data, kind: source.kind, studentId: source.kind === 'STUDENT' ? source.subjectId : null, jobId: source.kind === 'JOB' ? source.subjectId : null,
    }, select: { id: true } })
    indexId = row.id
  }
  return { indexId, generation: data.generation, send: true, queued: true }
}

export async function requestStudentMatchingIndex(ctx: StudentCtx): Promise<{ indexId: string; generation: number }> {
  const result = await db.$transaction(async tx => {
    const source = await studentQueryTx(tx, ctx.userId, true)
    if (!source) throw new FeatureDisabledError()
    return requestIndexTx(tx, source)
  })
  if (result.send) await submitIndex(result.indexId, result.generation)
  return { indexId: result.indexId, generation: result.generation }
}
export async function requestJobMatchingIndex(ctx: EmployerCtx, raw: { jobId: string }): Promise<{ indexId: string; generation: number }> {
  const input = parse(z.object({ jobId: z.string().cuid() }).strict(), raw)
  const result = await db.$transaction(async tx => {
    await assertEmployerTx(tx, ctx)
    const owned = await tx.job.findFirst({ where: { id: input.jobId, companyId: ctx.companyId }, select: { id: true } })
    if (!owned) throw new NotFoundError()
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Job" WHERE id=${owned.id} FOR UPDATE`)
    const source = await talentQueryTx(tx, ctx, owned.id)
    if (!source) throw new FeatureDisabledError()
    return requestIndexTx(tx, source)
  })
  if (result.send) await submitIndex(result.indexId, result.generation)
  return { indexId: result.indexId, generation: result.generation }
}

export type MatchingIndexDispatchOptions = {
  signal?: AbortSignal
  send?: (payload: { indexId: string; generation: number }) => Promise<string | null>
}

export async function dispatchPendingMatchingIndexes(options: MatchingIndexDispatchOptions = {}): Promise<void> {
  if (options.signal?.aborted) return
  // No optional vector capability means no physical-cleanup success or probe stamp.
  if (await isSemanticStoreAvailable()) {
    const cleanupDue = new Date()
    const cancelled = await db.semanticIndex.findMany({ where: { state: 'CANCELLED',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: cleanupDue } }] },
    select: { id: true, generation: true }, orderBy: [{ nextAttemptAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }], take: 50 })
    for (const row of cancelled) {
      if (options.signal?.aborted) return
      await cleanupVector({ indexId: row.id, generation: row.generation })
    }
  }
  if (options.signal?.aborted || !await getMatchingConfiguration() || options.signal?.aborted) return
  const now = new Date()
  const pending = await db.semanticIndex.findMany({ where: { OR: [
    { state: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    { state: 'PROCESSING', leaseExpiresAt: { lte: now } },
  ] }, select: { id: true, generation: true }, orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }], take: 50 })
  for (const row of pending) {
    if (options.signal?.aborted || !await getMatchingConfiguration() || options.signal?.aborted) break
    if (!await submitMatchingIndexSettled({ indexId: row.id, generation: row.generation }, options)) break
  }
}

async function submitMatchingIndexSettled(
  payload: { indexId: string; generation: number }, options: MatchingIndexDispatchOptions,
): Promise<boolean> {
  if (options.signal?.aborted) return false
  try {
    let id: string | null
    if (options.send) {
      // Registry supplies its already-started boss. Retain this promise through actual settlement.
      id = await options.send(payload)
    } else {
      await sendBoss.start()
      if (options.signal?.aborted) return false
      id = await sendBoss.send('matching-index', payload)
    }
    if (typeof id === 'string' && id.length > 0) return true
  } catch { /* Keep metadata pending for the next bounded recovery pass. */ }
  logger.warn({ event: 'matching_dispatch_pending' }, 'Matching dispatch pending')
  return false
}

async function queryVector(before: QuerySnapshot, reload: (tx: Prisma.TransactionClient) => Promise<QuerySnapshot | null>): Promise<number[] | null> {
  if (!await isSemanticStoreAvailable()) { await recheckQuery(before, reload); return null }
  await recheckQuery(before, reload)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  type Result = Awaited<ReturnType<typeof embedMatchingText>>
  const attempt = Promise.resolve().then(() => embedMatchingText({ text: before.source.text, inputType: 'query',
    model: before.config.model, configurationId: before.config.configurationId }, { signal: controller.signal }))
    .catch((): Result => ({ ok: false, reason: 'unavailable' }))
  let result: Result
  try {
    result = await Promise.race([attempt, new Promise<Result>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve({ ok: false, reason: 'timeout' }) }, 20_000)
    })])
  } finally { if (timer) clearTimeout(timer) }
  await recheckQuery(before, reload)
  if (!result.ok || result.model !== before.config.model) return null
  const parsed = embeddingVectorSchema.safeParse(result.vector)
  return parsed.success ? parsed.data : null
}

function validatedNeighbors(rows: SemanticNeighbor[], limit: number): SemanticNeighbor[] {
  const schema = z.object({ indexId: z.string().cuid(), subjectId: z.string().cuid(), generation: z.number().int().positive(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/), distance: z.number().finite().min(0).max(2) })
  const valid = rows.slice(0, 200).flatMap(row => { const parsed = schema.safeParse(row); return parsed.success ? [parsed.data] : [] })
    .sort((a, b) => a.distance - b.distance || (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0))
  const seen = new Set<string>()
  return valid.filter(row => { if (seen.has(row.subjectId)) return false; seen.add(row.subjectId); return true }).slice(0, limit)
}
function neighborMatches(row: SemanticNeighbor, index: SemanticIndex | null, config: MatchingConfiguration): index is SemanticIndex {
  return index !== null && index.state === 'READY' && index.id === row.indexId && (index.studentId ?? index.jobId) === row.subjectId &&
    index.generation === row.generation && index.sourceHash === row.sourceHash &&
    index.configurationId === config.configurationId && index.model === config.model && index.gateEpoch === config.gateEpoch && index.legalVersion === config.legalVersion
}

export async function recommendTalents(ctx: EmployerCtx, raw: { jobId: string; limit?: number }): Promise<MatchingResult<TalentCard>> {
  const input = parse(recommendTalentsSchema, raw)
  const reload = (tx: Prisma.TransactionClient) => talentQueryTx(tx, ctx, input.jobId)
  const before = await db.$transaction(reload)
  if (!before) return unavailable()
  if (!await isSemanticStoreAvailable()) { await recheckQuery(before, reload); return unavailable() }
  const max = z.number().int().min(1).max(100000).safeParse(await getSetting<unknown>('limits.searchPagesPerDay', 300, { fresh: true }))
  if (!max.success) return unavailable()
  const rate = await checkRateLimit(`talent-search-pages:${ctx.userId}`, { windowMs: 86_400_000, limit: max.data })
  if (!rate.allowed) {
    await logAudit({ actorId: ctx.userId, action: 'talent.limit.hit', targetType: 'TalentSearch', metadata: { kind: 'searchPages', companyId: ctx.companyId } })
    throw new RateLimitedError()
  }
  const vector = await queryVector(before, reload)
  if (!vector) return unavailable()
  let neighbors: SemanticNeighbor[]
  try { neighbors = await findTalentNeighbors({ vector, ...before.config, companyId: ctx.companyId, limit: input.limit }) }
  catch { await recheckQuery(before, reload); return unavailable() }
  await recheckQuery(before, reload)
  const rows = validatedNeighbors(neighbors, input.limit)
  const identity = await canSeeIdentityMany(ctx.companyId, rows.map(row => row.subjectId))
  return db.$transaction(async tx => {
    sameQuery(before, await reload(tx))
    const items: TalentCard[] = []
    for (const row of rows) {
      const index = await tx.semanticIndex.findUnique({ where: { id: row.indexId } })
      if (!neighborMatches(row, index, before.config) || index.kind !== 'STUDENT') continue
      const profile = await tx.studentProfile.findUnique({ where: { id: row.subjectId }, select: profileCardSelect })
      if (!profile || !await eligibleStudentTx(tx, profile) || !await isStudentVisibleToCompany(profile.id, ctx.companyId, tx)) continue
      let grant: string
      try { await legalTx(tx, profile.userId, before.config.legalVersion); grant = await matchingGrantTx(tx, profile.userId, before.config.legalVersion) }
      catch (error) { if (error instanceof AppError) continue; throw error }
      const source = buildStudentMatchingText(profile)
      if (!source || source.sourceHash !== row.sourceHash || index.sourceRevision !== profile.editRevision || index.consentGrantId !== grant) continue
      // The existing identity service remains authoritative; intersect its result with a final current-row fence.
      const currentUnlock = identity.has(profile.id) ? await tx.talentUnlock.findUnique({
        where: { companyId_studentId: { companyId: ctx.companyId, studentId: profile.id } }, select: { id: true },
      }) : null
      items.push(toTalentCard(profile, { unlocked: currentUnlock !== null }))
    }
    sameQuery(before, await reload(tx))
    return { items, availability: 'ready' as const }
  })
}

export async function recommendJobs(ctx: StudentCtx, raw: { limit?: number }): Promise<MatchingResult<JobListItem>> {
  const input = parse(recommendJobsSchema, raw)
  const reload = (tx: Prisma.TransactionClient) => studentQueryTx(tx, ctx.userId)
  const before = await db.$transaction(reload)
  if (!before) return unavailable()
  const vector = await queryVector(before, reload)
  if (!vector) return unavailable()
  let neighbors: SemanticNeighbor[]
  try { neighbors = await findJobNeighbors({ vector, ...before.config, studentId: before.subjectId, limit: input.limit }) }
  catch { await recheckQuery(before, reload); return unavailable() }
  await recheckQuery(before, reload)
  const rows = validatedNeighbors(neighbors, input.limit)
  return db.$transaction(async tx => {
    sameQuery(before, await reload(tx))
    const items: JobListItem[] = []
    for (const row of rows) {
      const index = await tx.semanticIndex.findUnique({ where: { id: row.indexId } })
      if (!neighborMatches(row, index, before.config) || index.kind !== 'JOB' || index.consentGrantId !== null) continue
      const job = await tx.job.findUnique({ where: { id: row.subjectId }, select: jobListSelect })
      if (!job || !publicJob(job) || index.sourceRevision !== job.matchingRevision || buildJobMatchingText(job).sourceHash !== row.sourceHash) continue
      items.push(toJobListItem({ ...job, company: {
        id: job.company.id, displayNameZh: job.company.displayNameZh,
        displayNameEn: job.company.displayNameEn, legalName: job.company.legalName,
      } }))
    }
    sameQuery(before, await reload(tx))
    return { items, availability: 'ready' as const }
  })
}

export type MatchingCorpusResult = { studentsVisited: number; jobsVisited: number; queued: number }
type CorpusKind = 'STUDENT' | 'JOB'
class MatchingCorpusStopped extends Error {}
async function assertCorpusGateTx(tx: Prisma.TransactionClient, before: MatchingConfiguration, signal?: AbortSignal): Promise<void> {
  const current = await getMatchingConfiguration(tx)
  if (signal?.aborted || !current || !sameMatchingConfiguration(before, current)) throw new MatchingCorpusStopped()
}

/** One short transaction: progress row -> source lock -> current metadata. No queue/provider I/O. */
async function reconcileCorpusStep(kind: CorpusKind, signal?: AbortSignal): Promise<{ visited: boolean; queued: boolean; done: boolean }> {
  const stopped = { visited: false, queued: false, done: true }
  try { return await db.$transaction(async tx => {
    const config = await getMatchingConfiguration(tx)
    if (signal?.aborted || !config) return stopped
    // The unique kind key limits this table to the two enum values. Concurrent
    // initialization uses ON CONFLICT DO NOTHING, rather than catch/retry in an aborted tx.
    await tx.matchingCorpusCursor.createMany({ data: [{ kind }], skipDuplicates: true })
    const identity = await tx.matchingCorpusCursor.findUniqueOrThrow({ where: { kind }, select: { id: true } })
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "MatchingCorpusCursor" WHERE "id"=${identity.id} FOR UPDATE`)
    const cursor = await tx.matchingCorpusCursor.findUniqueOrThrow({ where: { id: identity.id } })
    await assertCorpusGateTx(tx, config, signal)
    const range = cursor.afterId === null ? {} : { id: { gt: cursor.afterId } }
    const next = kind === 'STUDENT'
      ? await tx.studentProfile.findFirst({ where: range, select: { id: true, userId: true }, orderBy: { id: 'asc' } })
      : await tx.job.findFirst({ where: range, select: { id: true }, orderBy: { id: 'asc' } })
    if (!next) {
      // Stop at wrap: never rescan a small corpus repeatedly within one tick.
      await assertCorpusGateTx(tx, config, signal)
      const reset = await tx.matchingCorpusCursor.updateMany({
        where: { id: cursor.id, afterId: cursor.afterId }, data: { afterId: null },
      })
      if (reset.count !== 1) throw new ConflictError('Matching corpus cursor changed')
      return stopped
    }
    let queued = false
    try {
      let source: MatchingSourceSnapshot | null
      if (kind === 'STUDENT') {
        if (!('userId' in next) || typeof next.userId !== 'string') {
          throw new ConflictError('Matching corpus student source changed')
        }
        source = await studentQueryTx(tx, next.userId, true)
      }
      else {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Job" WHERE "id"=${next.id} FOR UPDATE`)
        source = await jobIndexSourceTx(tx, next.id)
      }
      if (!source) {
        // Disabled gate must not advance machine progress. An empty projection
        // or an unavailable public source is skipped only while the gate remains valid.
        await assertCorpusGateTx(tx, config, signal)
      } else queued = (await requestIndexTx(tx, source, true)).queued
    } catch (error) {
      // An ineligible/invalid source consumes one visit and cannot starve later
      // sources. Database errors and CAS conflicts rollback source + checkpoint.
      if (!(error instanceof ForbiddenError || error instanceof NotFoundError ||
        error instanceof VersionMismatchError || error instanceof FeatureDisabledError || error instanceof ValidationError)) throw error
      await assertCorpusGateTx(tx, config, signal)
    }
    await assertCorpusGateTx(tx, config, signal)
    const moved = await tx.matchingCorpusCursor.updateMany({
      where: { id: cursor.id, afterId: cursor.afterId }, data: { afterId: next.id },
    })
    if (moved.count !== 1) throw new ConflictError('Matching corpus cursor changed')
    return { visited: true, queued, done: false }
  }) } catch (error) {
    if (error instanceof MatchingCorpusStopped) return stopped
    throw error
  }
}

/** Bounded discovery only; the separate existing dispatcher delivers durable QUEUED rows. */
export async function reconcileMatchingCorpus(options: { signal?: AbortSignal } = {}): Promise<MatchingCorpusResult> {
  const result: MatchingCorpusResult = { studentsVisited: 0, jobsVisited: 0, queued: 0 }
  if (options.signal?.aborted || !await getMatchingConfiguration()) return result
  const limit = z.number().int().min(1).max(50).safeParse(
    await getSetting<unknown>('ai.matching.reconcileBatchSize', 25, { fresh: true }),
  )
  if (!limit.success || !await isSemanticStoreAvailable()) return result
  const done = { STUDENT: false, JOB: false }
  // Independent per-kind quotas and alternating visits prevent a large student
  // corpus or a run of ineligible rows from consuming the job allocation.
  for (let visit = 0; visit < limit.data; visit++) {
    for (const kind of ['STUDENT', 'JOB'] as const) {
      if (options.signal?.aborted) return result
      if (done[kind]) continue
      const step = await reconcileCorpusStep(kind, options.signal)
      done[kind] = step.done
      if (step.visited) result[kind === 'STUDENT' ? 'studentsVisited' : 'jobsVisited']++
      if (step.queued) result.queued++
    }
    if (done.STUDENT && done.JOB) break
  }
  return result
}
