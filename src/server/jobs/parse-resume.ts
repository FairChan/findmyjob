import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type ResumeParseDraft } from '@prisma/client'
import { z } from 'zod'
import { redact, REDACTED } from '@/lib/redact'
import { getObjectBytes } from '@/lib/storage'
import { db } from '../db'
import { AppError, ValidationError } from '../errors'
import { LOCK_NS, lockXact } from '../lib/advisory-locks'
import { extractResumeText, withResumeTextSlot, type ResumeTextFailure } from '../lib/resume-text'
import { generateResumeSuggestion, type ResumeProviderFailure } from '../lib/ai/resume-provider'
import { getSetting } from '../services/settings'
import {
  normalizeResumeSuggestion, type ResumeParseFailureCode, type ResumeSuggestionV1,
} from '../schemas/resume-parsing'
import {
  assertResumeParseAccessTx, isResumeParseSnapshotCurrent, type ResumeParseAccess,
} from '../services/resume-parsing'

const payloadSchema = z.object({ resumeId: z.string().cuid(), generation: z.number().int().min(1) }).strict()
const MAX_ATTEMPTS = 3
const MAX_BYTES = 5 * 1024 * 1024
const LEASE_MS = 120_000
const ATTEMPT_MS = 90_000
const RETRY_MS = [30_000, 120_000] as const
const AUTH_ERRORS = new Set(['NOT_FOUND', 'FORBIDDEN', 'FEATURE_DISABLED', 'VERSION_MISMATCH'])

type Claim = { userId: string; draft: ResumeParseDraft; access: ResumeParseAccess }
type Failure = { code: ResumeParseFailureCode; retry: boolean }
class AttemptFailure extends Error {
  constructor(readonly failure: Failure) { super('Resume parsing attempt failed') }
}

function terminalData(code: ResumeParseFailureCode, cancelled = false): Prisma.ResumeParseDraftUpdateManyMutationInput {
  return {
    state: cancelled ? 'CANCELLED' : 'FAILED',
    ...(cancelled ? { generation: { increment: 1 } } : {}),
    payload: Prisma.DbNull, failureCode: code, nextAttemptAt: null,
    leaseToken: null, leaseExpiresAt: null, completedAt: new Date(),
    confirmationHash: null, appliedProfileRevision: null, confirmedAt: null,
  }
}

function fence(claim: Claim): Prisma.ResumeParseDraftWhereInput {
  return {
    id: claim.draft.id, resumeId: claim.draft.resumeId, generation: claim.draft.generation,
    state: 'PROCESSING', attempts: claim.draft.attempts, leaseToken: claim.draft.leaseToken,
    leaseExpiresAt: { gt: new Date() },
  }
}

/** Caller holds STUDENT_DATA. A cancellation is returned, so the transaction can commit it. */
async function authorizeTx(
  tx: Prisma.TransactionClient, userId: string, draft: ResumeParseDraft,
  where: Prisma.ResumeParseDraftWhereInput,
): Promise<ResumeParseAccess | null> {
  const source = await tx.resumeFile.findUnique({
    where: { id: draft.resumeId },
    select: { storageKey: true, contentSha256: true, student: { select: { userId: true } } },
  })
  if (!source) return null
  if (source.student.userId !== userId || source.storageKey !== draft.sourceStorageKey ||
    source.contentSha256 === null || source.contentSha256 !== draft.sourceSha256) {
    await tx.resumeParseDraft.updateMany({ where, data: terminalData('SOURCE_CHANGED') })
    return null
  }
  let access: ResumeParseAccess
  try {
    access = await assertResumeParseAccessTx(tx, userId, draft.resumeId)
  } catch (error) {
    // A database outage is not evidence that the student withdrew consent.
    if (!(error instanceof AppError) || !AUTH_ERRORS.has(error.code)) throw error
    await tx.resumeParseDraft.updateMany({ where, data: terminalData('AUTHORIZATION_CHANGED', true) })
    return null
  }
  if (!isResumeParseSnapshotCurrent(draft, access)) {
    await tx.resumeParseDraft.updateMany({ where, data: terminalData('AUTHORIZATION_CHANGED', true) })
    return null
  }
  return access
}

async function claimAttempt(payload: z.infer<typeof payloadSchema>, signal: AbortSignal): Promise<Claim | null> {
  if (signal.aborted) return null
  const owner = await db.resumeFile.findUnique({
    where: { id: payload.resumeId }, select: { student: { select: { userId: true } } },
  })
  if (!owner || signal.aborted) return null
  const userId = owner.student.userId
  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, userId)
    if (signal.aborted) return null
    const draft = await tx.resumeParseDraft.findUnique({ where: { resumeId: payload.resumeId } })
    if (!draft || draft.generation !== payload.generation) return null
    const now = new Date()
    const due = draft.state === 'QUEUED' && (draft.nextAttemptAt === null || draft.nextAttemptAt <= now)
    const expired = draft.state === 'PROCESSING' && draft.leaseExpiresAt !== null && draft.leaseExpiresAt <= now
    if (!due && !expired) return null
    const where: Prisma.ResumeParseDraftWhereInput = {
      id: draft.id, generation: draft.generation, state: draft.state, attempts: draft.attempts,
      leaseToken: draft.leaseToken,
      ...(due ? { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }
        : { leaseExpiresAt: { lte: now } }),
    }
    const access = await authorizeTx(tx, userId, draft, where)
    if (!access || signal.aborted) return null
    if (draft.attempts >= MAX_ATTEMPTS || draft.attempts < 0) {
      await tx.resumeParseDraft.updateMany({ where, data: terminalData('ATTEMPTS_EXHAUSTED') })
      return null
    }
    const leaseToken = randomUUID()
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS)
    const attempts = draft.attempts + 1
    const updated = await tx.resumeParseDraft.updateMany({ where, data: {
      state: 'PROCESSING', attempts, leaseToken, leaseExpiresAt, nextAttemptAt: null,
      failureCode: null, payload: Prisma.DbNull, responseModel: null, completedAt: null,
    } })
    if (updated.count !== 1) return null
    return { userId, access, draft: { ...draft, state: 'PROCESSING', attempts, leaseToken, leaseExpiresAt } }
  })
}

async function currentClaimTx(tx: Prisma.TransactionClient, claim: Claim): Promise<ResumeParseAccess | null> {
  await lockXact(tx, LOCK_NS.STUDENT_DATA, claim.userId)
  const draft = await tx.resumeParseDraft.findFirst({ where: fence(claim) })
  if (!draft) return null
  return authorizeTx(tx, claim.userId, draft, fence(claim))
}

async function finishFailure(claim: Claim, failure: Failure): Promise<void> {
  await db.$transaction(async tx => {
    if (!await currentClaimTx(tx, claim)) return
    const canRetry = failure.retry && claim.draft.attempts < MAX_ATTEMPTS
    await tx.resumeParseDraft.updateMany({ where: fence(claim), data: canRetry ? {
      state: 'QUEUED', payload: Prisma.DbNull, failureCode: failure.code,
      nextAttemptAt: new Date(Date.now() + RETRY_MS[claim.draft.attempts - 1]!),
      leaseToken: null, leaseExpiresAt: null, completedAt: null,
    } : terminalData(failure.retry ? 'ATTEMPTS_EXHAUSTED' : failure.code) })
  })
}

function extractionFailure(reason: ResumeTextFailure): Failure {
  switch (reason) {
    case 'encrypted': return { code: 'PDF_ENCRYPTED', retry: false }
    case 'too_many_pages': return { code: 'PDF_TOO_MANY_PAGES', retry: false }
    case 'empty': return { code: 'PDF_NO_TEXT', retry: false }
    case 'input_limit': case 'text_limit': case 'output_limit': return { code: 'PDF_LIMIT', retry: false }
    case 'timeout': case 'aborted': return { code: 'EXTRACTION_TIMEOUT', retry: true }
    default: return { code: 'PDF_INVALID', retry: false }
  }
}

function providerFailure(reason: ResumeProviderFailure): Failure {
  switch (reason) {
    case 'refusal': return { code: 'PROVIDER_REFUSAL', retry: false }
    case 'truncated': return { code: 'OUTPUT_TRUNCATED', retry: false }
    case 'invalid': return { code: 'OUTPUT_INVALID', retry: false }
    case 'timeout': case 'aborted': return { code: 'PROVIDER_TIMEOUT', retry: true }
    case 'configuration': return { code: 'PROVIDER_UNAVAILABLE', retry: false }
    default: return { code: 'PROVIDER_UNAVAILABLE', retry: true }
  }
}

function storageFailure(error: unknown): Failure {
  const value = error !== null && typeof error === 'object' ? error as { name?: unknown; code?: unknown } : null
  if (value?.name === 'NoSuchKey' || value?.code === 'NoSuchKey') return { code: 'SOURCE_MISSING', retry: false }
  if (value?.code === 'FILE_TOO_LARGE') return { code: 'PDF_LIMIT', retry: false }
  return { code: 'SOURCE_MISSING', retry: true }
}

function careerText(value: string): string {
  if (value.length > 100_000 || Buffer.byteLength(value, 'utf8') > 400 * 1024) {
    throw new AttemptFailure({ code: 'PDF_LIMIT', retry: false })
  }
  // Remove explicitly labelled identity/contact rows before the existing contact redactor.
  // This minimizes the submitted text; it is not a claim of complete anonymization.
  const text = redact(value.replace(/\r\n?/g, '\n').split('\n').filter(line =>
    !/^\s*(?:full\s*name|name|address|date\s*of\s*birth|dob|passport|nationality|gender|姓名|地址|住址|出生日期|护照|国籍|性别)\s*[:：]/iu.test(line),
  ).join('\n')).trim()
  if (!text.replaceAll(REDACTED, '').trim()) throw new AttemptFailure({ code: 'PDF_NO_TEXT', retry: false })
  return text
}

async function readText(claim: Claim, signal: AbortSignal): Promise<string | null> {
  return withResumeTextSlot(async slotSignal => {
    if (slotSignal.aborted) throw new AttemptFailure({ code: 'EXTRACTION_TIMEOUT', retry: true })
    // Admission can wait behind another PDF. Recheck before reading any bytes after that wait.
    if (!await db.$transaction(tx => currentClaimTx(tx, claim))) return null
    if (slotSignal.aborted) throw new AttemptFailure({ code: 'EXTRACTION_TIMEOUT', retry: true })
    const maxPages = await getSetting<unknown>('resume.maxPages', 20, { fresh: true })
    if (typeof maxPages !== 'number' || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
      throw new AttemptFailure({ code: 'PDF_LIMIT', retry: false })
    }
    let bytes: Buffer
    try {
      const readSignal = AbortSignal.any([slotSignal, AbortSignal.timeout(10_000)])
      bytes = await getObjectBytes(claim.access.resume.storageKey, { maxBytes: MAX_BYTES, signal: readSignal })
      if (readSignal.aborted) throw new AttemptFailure({ code: 'SOURCE_MISSING', retry: true })
    } catch (error) {
      if (error instanceof AttemptFailure) throw error
      throw new AttemptFailure(storageFailure(error))
    }
    if (slotSignal.aborted) throw new AttemptFailure({ code: 'EXTRACTION_TIMEOUT', retry: true })
    if (bytes.length > MAX_BYTES) throw new AttemptFailure({ code: 'PDF_LIMIT', retry: false })
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== claim.draft.sourceSha256 || hash !== claim.access.resume.contentSha256 ||
      bytes.length !== claim.access.resume.sizeBytes) {
      throw new AttemptFailure({ code: 'SOURCE_CHANGED', retry: false })
    }
    let extracted
    try { extracted = await extractResumeText(bytes, { maxPages, signal: slotSignal }) } catch {
      throw new AttemptFailure({ code: 'PDF_INVALID', retry: false })
    }
    if (slotSignal.aborted) throw new AttemptFailure({ code: 'EXTRACTION_TIMEOUT', retry: true })
    if (!extracted.ok) throw new AttemptFailure(extractionFailure(extracted.reason))
    if (!Number.isInteger(extracted.pageCount) || extracted.pageCount < 1 || extracted.pageCount > maxPages ||
      typeof extracted.text !== 'string') throw new AttemptFailure({ code: 'PDF_INVALID', retry: false })
    return careerText(extracted.text)
  }, { signal })
}

async function publish(claim: Claim, payload: ResumeSuggestionV1, responseModel: string, signal: AbortSignal) {
  await db.$transaction(async tx => {
    if (!await currentClaimTx(tx, claim) || signal.aborted) return
    const changed = await tx.resumeParseDraft.updateMany({ where: fence(claim), data: {
      state: 'READY', payload: payload as Prisma.InputJsonValue, responseModel,
      failureCode: null, leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null, completedAt: new Date(),
    } })
    if (changed.count !== 1) return
    // A cancelled asynchronous write must roll back before the transaction commits.
    if (signal.aborted) throw new AttemptFailure({ code: 'PROVIDER_TIMEOUT', retry: true })
  })
}

export async function runResumeParse(
  payload: { resumeId: string; generation: number }, options?: { signal?: AbortSignal },
): Promise<void> {
  if (options?.signal?.aborted) return
  const input = payloadSchema.safeParse(payload)
  if (!input.success) throw new ValidationError('Invalid resume parsing job')
  const controller = new AbortController()
  const signal = options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(), ATTEMPT_MS)
  let claim: Claim | null = null
  let phase: 'source' | 'provider' = 'source'
  try {
    claim = await claimAttempt(input.data, signal)
    if (!claim) return
    let text: string | null
    try { text = await readText(claim, signal) } catch (error) {
      throw error instanceof AttemptFailure ? error
        : new AttemptFailure({ code: 'EXTRACTION_TIMEOUT', retry: true })
    }
    if (text === null) return
    // No lifecycle lock or storage/extraction slot is held across the provider call.
    if (!await db.$transaction(tx => currentClaimTx(tx, claim!))) return
    if (signal.aborted) throw new AttemptFailure({ code: 'EXTRACTION_TIMEOUT', retry: true })
    phase = 'provider'
    let generated
    try {
      generated = await generateResumeSuggestion({
        text, model: claim.draft.requestedModel, promptVersion: claim.draft.promptVersion, schemaVersion: 1,
      }, { signal })
    } catch {
      throw new AttemptFailure({ code: 'PROVIDER_UNAVAILABLE', retry: true })
    }
    if (signal.aborted) throw new AttemptFailure({ code: 'PROVIDER_TIMEOUT', retry: true })
    if (!generated.ok) throw new AttemptFailure(providerFailure(generated.reason))
    let suggestion: ResumeSuggestionV1
    try {
      if (typeof generated.responseModel !== 'string' || !generated.responseModel.trim() ||
        generated.responseModel.length > 200 || /[\u0000-\u001f\u007f]/u.test(generated.responseModel)) {
        throw new Error('Invalid response model')
      }
      suggestion = normalizeResumeSuggestion(generated.output)
    } catch { throw new AttemptFailure({ code: 'OUTPUT_INVALID', retry: false }) }
    await publish(claim, suggestion, generated.responseModel, signal)
  } catch (error) {
    if (claim && (error instanceof AttemptFailure || signal.aborted)) {
      const failure = error instanceof AttemptFailure ? error.failure : {
        code: phase === 'provider' ? 'PROVIDER_TIMEOUT' as const : 'EXTRACTION_TIMEOUT' as const, retry: true,
      }
      try { await finishFailure(claim, failure) } catch {
        // Keep the durable finite lease recoverable, without leaking database/provider error details.
        throw new AppError('Resume parsing recovery failed', 'RESUME_PARSE_JOB_FAILED', 503)
      }
      return
    }
    throw new AppError('Resume parsing job failed', 'RESUME_PARSE_JOB_FAILED', 503)
  } finally { clearTimeout(timer) }
}
