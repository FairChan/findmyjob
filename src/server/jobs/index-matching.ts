import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Prisma, SemanticIndex } from '@prisma/client'
import { z } from 'zod'
import { embeddingVectorSchema } from '@/schemas/semantic-matching'
import { db } from '../db'
import { AppError, ConflictError } from '../errors'
import { logger } from '../lib/logger'
import { embedMatchingText } from '../lib/ai/embedding-provider'
import { isSemanticStoreAvailable, writeSemanticVector } from '../lib/semantic-store'
import {
  loadMatchingIndexSourceTx, lockMatchingIndexTx, matchingIndexIsCurrent,
  type MatchingSourceSnapshot, type MatchingFailureCode,
} from '../services/semantic-matching'

const payloadSchema = z.object({ indexId: z.string().cuid(), generation: z.number().int().positive() }).strict()
const LEASE_MS = 120_000
const ATTEMPT_MS = 60_000
const RETRY_MS = [30_000, 120_000] as const
type Claim = { index: SemanticIndex; source: MatchingSourceSnapshot }
type Failure = { code: MatchingFailureCode; retry: boolean }

function fence(claim: Claim): Prisma.SemanticIndexWhereInput {
  return { id: claim.index.id, generation: claim.index.generation, state: 'PROCESSING',
    leaseToken: claim.index.leaseToken, attempts: claim.index.attempts, leaseExpiresAt: { gt: new Date() } }
}
function owned(index: SemanticIndex, claim: Claim): boolean {
  return index.id === claim.index.id && index.generation === claim.index.generation && index.state === 'PROCESSING' &&
    index.leaseToken === claim.index.leaseToken && index.attempts === claim.index.attempts &&
    index.leaseExpiresAt !== null && index.leaseExpiresAt.getTime() > Date.now()
}
function terminal(code: MatchingFailureCode, cancelled = false): Prisma.SemanticIndexUpdateManyMutationInput {
  return { state: cancelled ? 'CANCELLED' : 'FAILED', ...(cancelled ? { generation: { increment: 1 } } : {}),
    failureCode: code, leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null, completedAt: new Date() }
}

async function authorizeSourceTx(tx: Prisma.TransactionClient, index: SemanticIndex, where: Prisma.SemanticIndexWhereInput): Promise<MatchingSourceSnapshot | null> {
  let source: MatchingSourceSnapshot | null
  try { source = await loadMatchingIndexSourceTx(tx, index) }
  catch (error) {
    if (!(error instanceof AppError)) throw error
    await tx.semanticIndex.updateMany({ where, data: terminal(error.code === 'VALIDATION_ERROR' ? 'SOURCE_UNAVAILABLE' : 'AUTHORIZATION_CHANGED', true) })
    return null
  }
  if (!source || !matchingIndexIsCurrent(index, source)) {
    const code = source && (source.source.sourceHash !== index.sourceHash || source.sourceRevision !== index.sourceRevision)
      ? 'SOURCE_CHANGED' : 'CONFIGURATION_CHANGED'
    await tx.semanticIndex.updateMany({ where, data: terminal(code, true) })
    return null
  }
  return source
}

async function claimAttempt(payload: z.infer<typeof payloadSchema>, signal: AbortSignal): Promise<Claim | null> {
  return db.$transaction(async tx => {
    if (signal.aborted) return null
    const index = await lockMatchingIndexTx(tx, payload.indexId)
    if (!index || index.generation !== payload.generation || signal.aborted) return null
    const now = new Date()
    const due = index.state === 'QUEUED' && (index.nextAttemptAt === null || index.nextAttemptAt <= now)
    const expired = index.state === 'PROCESSING' && index.leaseExpiresAt !== null && index.leaseExpiresAt <= now
    if (!due && !expired) return null
    const where: Prisma.SemanticIndexWhereInput = {
      id: index.id, generation: index.generation, state: index.state, attempts: index.attempts, leaseToken: index.leaseToken,
      ...(due ? { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] } : { leaseExpiresAt: { lte: now } }),
    }
    const source = await authorizeSourceTx(tx, index, where)
    if (!source || signal.aborted) return null
    if (index.attempts >= 3 || index.attempts < 0) {
      await tx.semanticIndex.updateMany({ where, data: terminal('ATTEMPTS_EXHAUSTED') })
      return null
    }
    const attempts = index.attempts + 1
    const leaseToken = randomUUID()
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS)
    const result = await tx.semanticIndex.updateMany({ where, data: {
      state: 'PROCESSING', attempts, leaseToken, leaseExpiresAt, nextAttemptAt: null, failureCode: null, completedAt: null,
    } })
    if (result.count !== 1) return null
    return { index: { ...index, state: 'PROCESSING', attempts, leaseToken, leaseExpiresAt }, source }
  })
}

async function currentClaimTx(tx: Prisma.TransactionClient, claim: Claim): Promise<MatchingSourceSnapshot | null> {
  const index = await lockMatchingIndexTx(tx, claim.index.id)
  if (!index || !owned(index, claim)) return null
  return authorizeSourceTx(tx, index, fence(claim))
}
async function fail(claim: Claim, failure: Failure): Promise<void> {
  await db.$transaction(async tx => {
    if (!await currentClaimTx(tx, claim)) return
    const canRetry = failure.retry && claim.index.attempts < 3
    await tx.semanticIndex.updateMany({ where: fence(claim), data: canRetry ? {
      state: 'QUEUED', failureCode: failure.code, leaseToken: null, leaseExpiresAt: null,
      nextAttemptAt: new Date(Date.now() + RETRY_MS[claim.index.attempts - 1]!), completedAt: null,
    } : terminal(failure.retry ? 'ATTEMPTS_EXHAUSTED' : failure.code) })
  })
}

async function embed(claim: Claim, signal: AbortSignal) {
  type Result = Awaited<ReturnType<typeof embedMatchingText>>
  if (signal.aborted) return { ok: false, reason: 'aborted' } as const
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const controller = new AbortController()
  const stopped = new Promise<Result>(resolve => {
    onAbort = () => { controller.abort(); resolve({ ok: false, reason: 'aborted' }) }
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => { controller.abort(); resolve({ ok: false, reason: 'timeout' }) }, ATTEMPT_MS)
    if (signal.aborted) onAbort()
  })
  const attempt = Promise.resolve().then(() => controller.signal.aborted
    ? ({ ok: false, reason: 'aborted' } as const)
    : embedMatchingText({ text: claim.source.source.text, inputType: 'document', model: claim.index.model,
      configurationId: claim.index.configurationId }, { signal: controller.signal }))
    .catch((): Result => ({ ok: false, reason: 'unavailable' }))
  try { return await Promise.race([attempt, stopped]) }
  finally {
    // Abort the transport promptly, but retain the real provider/cancellation tail.
    // A race sentinel cannot release this runner or its lifecycle ownership.
    await attempt
    if (timer) clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export async function runMatchingIndex(
  raw: { indexId: string; generation: number }, options: { signal?: AbortSignal } = {},
): Promise<void> {
  const payload = payloadSchema.safeParse(raw)
  if (!payload.success || options.signal?.aborted) return
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const deadline = setTimeout(abort, ATTEMPT_MS)
  const signal = controller.signal
  if (options.signal?.aborted) abort()
  let claim: Claim | null = null
  try {
    claim = await claimAttempt(payload.data, signal)
    if (!claim) return
    if (!await isSemanticStoreAvailable()) { await fail(claim, { code: 'STORE_UNAVAILABLE', retry: true }); return }
    if (!await db.$transaction(tx => currentClaimTx(tx, claim!))) return
    if (signal.aborted) { await fail(claim, { code: 'PROVIDER_TIMEOUT', retry: true }); return }
    const result = await embed(claim, signal)
    if (!result.ok) {
      await fail(claim, { code: result.reason === 'timeout' || result.reason === 'aborted' ? 'PROVIDER_TIMEOUT'
        : result.reason === 'invalid' ? 'OUTPUT_INVALID' : 'PROVIDER_UNAVAILABLE',
      retry: result.reason === 'timeout' || result.reason === 'unavailable' || result.reason === 'aborted' })
      return
    }
    const vector = embeddingVectorSchema.safeParse(result.vector)
    if (!vector.success || result.model !== claim.index.model) { await fail(claim, { code: 'OUTPUT_INVALID', retry: false }); return }
    if (signal.aborted) { await fail(claim, { code: 'PROVIDER_TIMEOUT', retry: true }); return }
    await db.$transaction(async tx => {
      if (signal.aborted || !await currentClaimTx(tx, claim!)) return
      await writeSemanticVector(tx, { indexId: claim!.index.id, generation: claim!.index.generation, vector: vector.data })
      if (signal.aborted) throw new ConflictError()
      const published = await tx.semanticIndex.updateMany({ where: fence(claim!), data: {
        state: 'READY', leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null, completedAt: new Date(), failureCode: null,
      } })
      if (published.count !== 1) throw new ConflictError()
    })
  } catch {
    // No provider/source/SQL exception object crosses the job registry's telemetry boundary.
    if (claim) {
      try { await fail(claim, { code: 'STORE_UNAVAILABLE', retry: true }) }
      catch { /* Existing finite lease remains recoverable after a database outage. */ }
    }
    logger.warn({ event: 'matching_index_deferred' }, 'Matching index work deferred')
  } finally {
    clearTimeout(deadline)
    options.signal?.removeEventListener('abort', abort)
  }
}
