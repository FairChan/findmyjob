import 'server-only'
import { randomUUID } from 'node:crypto'
import type { DataExportArtifact, DataRequest, Prisma } from '@prisma/client'
import { db } from '../db'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { logger } from '../lib/logger'
import { deleteAllVersions } from '@/lib/storage'
import { sendBoss } from '../jobs/boss'
import { readDataExportSnapshot, type ExportSnapshot } from './data-export-snapshot'

export type ExportPayload = { requestId: string; userId: string }
export type ExportClaim = ExportPayload & {
  id: string; generation: number; leaseToken: string; storageKey: string; snapshot: ExportSnapshot
}
type Settlement = 'PUBLISHED' | 'CLEANUP_REQUIRED' | 'CLEANED' | 'MISSING' | 'DEFERRED'
const LEASE_MS = 5 * 60_000
const CLEANUP_LEASE_MS = 2 * 60_000
const CLEANUP_RETRY_MS = 5 * 60_000
const RETENTION_MS = 24 * 60 * 60_000
const CLEANUP_NOTE = 'EXPORT_CLEANUP_REQUIRED'
const workingStates = ['RESERVED', 'UPLOADING', 'UPLOADED'] as const

async function databaseNow(): Promise<Date> {
  const [clock] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`
  if (!clock) throw new Error('DATA_EXPORT_CLOCK_UNAVAILABLE')
  return clock.now
}

async function locked<T>(userId: string, work: (tx: Prisma.TransactionClient, now: Date) => Promise<T>): Promise<T> {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`
    await lockXact(tx, LOCK_NS.STUDENT_DATA, userId)
    await lockXact(tx, LOCK_NS.DATA_EXPORT, userId)
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`
    return work(tx, clock!.now)
  }, { isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 10_000 })
}

function ownsLease(request: DataRequest | null, artifact: DataExportArtifact, now: Date): boolean {
  return request !== null && request.userId === artifact.userId && request.type === 'EXPORT' &&
    request.status === 'OPEN' && request.exportGeneration === artifact.generation &&
    request.exportLeaseToken === artifact.leaseToken && request.exportLeaseExpiresAt !== null &&
    request.exportLeaseExpiresAt > now && artifact.leaseExpiresAt > now
}

/** Compatibility view only. The ledger remains authoritative for every losing key. */
async function syncRejectedCleanup(tx: Prisma.TransactionClient, requestId: string, userId: string): Promise<void> {
  const pending = await tx.dataExportArtifact.findFirst({
    where: { requestId, userId, state: 'CLEANUP_REQUIRED' }, orderBy: { createdAt: 'asc' },
  })
  await tx.dataRequest.updateMany({
    where: { id: requestId, userId, type: 'EXPORT', status: 'REJECTED', ...(!pending ? { note: CLEANUP_NOTE } : {}) },
    data: { resultKey: pending?.storageKey ?? null, note: pending ? CLEANUP_NOTE : null },
  })
}

/** Must be called inside a transaction already holding STUDENT_DATA -> DATA_EXPORT. */
export async function invalidateUserExportsTx(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`
  await tx.dataExportArtifact.updateMany({
    where: { userId, state: { not: 'CLEANED' } },
    data: { state: 'CLEANUP_REQUIRED', cleanupNextAt: clock!.now },
  })
  await tx.dataRequest.updateMany({
    where: { userId, type: 'EXPORT', status: { in: ['OPEN', 'DONE'] } },
    data: {
      status: 'REJECTED', exportGeneration: { increment: 1 }, exportLeaseToken: null,
      exportLeaseExpiresAt: null, resultKey: null, resolvedAt: clock!.now,
    },
  })
}

export async function claimDataExport(payload: ExportPayload): Promise<ExportClaim | null> {
  return locked(payload.userId, async (tx, now) => {
    const request = await tx.dataRequest.findUnique({ where: { id: payload.requestId } })
    if (!request || request.userId !== payload.userId || request.type !== 'EXPORT' || request.status !== 'OPEN') return null
    const user = await tx.user.findUnique({ where: { id: payload.userId }, select: { status: true } })
    if (user?.status !== 'ACTIVE') { await invalidateUserExportsTx(tx, payload.userId); return null }
    if (request.exportLeaseToken && request.exportLeaseExpiresAt && request.exportLeaseExpiresAt > now) return null
    // Any old generation loses publication rights before a new generation can start.
    await tx.dataExportArtifact.updateMany({
      where: { requestId: request.id, userId: payload.userId, state: { in: [...workingStates] } },
      data: { state: 'CLEANUP_REQUIRED', cleanupNextAt: now },
    })
    const generation = request.exportGeneration + 1
    const leaseToken = randomUUID()
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS)
    const id = randomUUID()
    const storageKey = `exports/${payload.userId}/${request.id}/${id}.zip`
    await tx.dataRequest.update({ where: { id: request.id }, data: {
      exportGeneration: generation, exportLeaseToken: leaseToken, exportLeaseExpiresAt: leaseExpiresAt,
    } })
    await tx.dataExportArtifact.create({ data: {
      id, requestId: request.id, userId: payload.userId, generation, leaseToken, leaseExpiresAt, storageKey,
    } })
    const snapshot = await readDataExportSnapshot(tx, payload.userId)
    if (!snapshot) throw new Error('DATA_EXPORT_SNAPSHOT_UNAVAILABLE')
    return { ...payload, id, generation, leaseToken, storageKey, snapshot }
  })
}

/** The only transition authorizing one physical PUT. Never retry the PUT with this key. */
export async function beginDataExportUpload(claim: ExportClaim): Promise<boolean> {
  return locked(claim.userId, async (tx, now) => {
    const artifact = await tx.dataExportArtifact.findUnique({ where: { id: claim.id } })
    if (!artifact || artifact.userId !== claim.userId || artifact.storageKey !== claim.storageKey || artifact.state !== 'RESERVED') return false
    const request = await tx.dataRequest.findUnique({ where: { id: artifact.requestId } })
    const user = await tx.user.findUnique({ where: { id: claim.userId }, select: { status: true } })
    if (user?.status !== 'ACTIVE' || !ownsLease(request, artifact, now)) return false
    await tx.dataExportArtifact.update({ where: { id: artifact.id }, data: { state: 'UPLOADING', uploadOutcome: 'UNKNOWN' } })
    return true
  })
}

/** Call only after the one PUT promise resolves successfully, never from a timeout/catch. */
export async function acknowledgeDataExportUpload(artifactId: string, userId: string): Promise<void> {
  await locked(userId, async tx => {
    const artifact = await tx.dataExportArtifact.findUnique({ where: { id: artifactId } })
    if (!artifact || artifact.userId !== userId || artifact.uploadOutcome !== 'UNKNOWN') return
    if (artifact.state !== 'UPLOADING' && artifact.state !== 'CLEANUP_REQUIRED') return
    await tx.dataExportArtifact.update({ where: { id: artifactId }, data: {
      uploadOutcome: 'ACKNOWLEDGED', ...(artifact.state === 'UPLOADING' ? { state: 'UPLOADED' } : {}),
    } })
  })
}

/** Fresh transaction reconciliation is mandatory after any ambiguous commit response. */
export async function settleDataExport(
  artifactId: string, userId: string, publish: boolean, options?: { recoveryOnly?: boolean },
): Promise<Settlement> {
  return locked(userId, async (tx, now): Promise<Settlement> => {
    const artifact = await tx.dataExportArtifact.findUnique({ where: { id: artifactId } })
    if (!artifact || artifact.userId !== userId) return 'MISSING'
    if (artifact.state === 'CLEANED') return 'CLEANED'
    const request = await tx.dataRequest.findUnique({ where: { id: artifact.requestId } })
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } })
    const active = user?.status === 'ACTIVE'
    // A scan is only a candidate list. Recheck current ownership and BOTH leases
    // with post-lock database time before recovery may invalidate working state.
    // Explicit worker abandonment intentionally omits recoveryOnly.
    if (options?.recoveryOnly && active && workingStates.some(state => state === artifact.state) &&
      ownsLease(request, artifact, now)) return 'DEFERRED'
    if (artifact.state === 'PUBLISHED' && request?.userId === userId && request.status === 'DONE' &&
      request.resultKey === artifact.storageKey && active && artifact.expiresAt && artifact.expiresAt > now) return 'PUBLISHED'
    if (publish && active && ownsLease(request, artifact, now) &&
      artifact.state === 'UPLOADED' && artifact.uploadOutcome === 'ACKNOWLEDGED') {
      const won = await tx.dataRequest.updateMany({
        where: { id: artifact.requestId, userId, type: 'EXPORT', status: 'OPEN',
          exportGeneration: artifact.generation, exportLeaseToken: artifact.leaseToken, exportLeaseExpiresAt: { gt: now } },
        data: { status: 'DONE', resultKey: artifact.storageKey, resolvedAt: now, note: null, exportLeaseToken: null, exportLeaseExpiresAt: null },
      })
      if (won.count !== 1) throw new Error('DATA_EXPORT_PUBLICATION_CONFLICT')
      await tx.dataExportArtifact.update({ where: { id: artifact.id }, data: {
        state: 'PUBLISHED', publishedAt: now, expiresAt: new Date(now.getTime() + RETENTION_MS),
      } })
      return 'PUBLISHED'
    }
    // This durable transition makes publication impossible BEFORE external deletion.
    await tx.dataExportArtifact.update({ where: { id: artifact.id }, data: { state: 'CLEANUP_REQUIRED', cleanupNextAt: now } })
    if (request?.userId === userId && request.status === 'OPEN' && request.exportGeneration === artifact.generation &&
      request.exportLeaseToken === artifact.leaseToken) {
      await tx.dataRequest.update({ where: { id: request.id }, data: {
        exportLeaseToken: null, exportLeaseExpiresAt: null,
        ...(!active ? { status: 'REJECTED', resolvedAt: now } : {}),
      } })
    }
    await syncRejectedCleanup(tx, artifact.requestId, userId)
    return 'CLEANUP_REQUIRED'
  })
}

export async function cleanupDataExport(artifactId: string, userId: string): Promise<void> {
  const deletion = await locked(userId, async (tx, now) => {
    const artifact = await tx.dataExportArtifact.findUnique({ where: { id: artifactId } })
    if (!artifact || artifact.userId !== userId || artifact.state !== 'CLEANUP_REQUIRED') return null
    if (artifact.cleanupLeaseToken && artifact.cleanupLeaseExpiresAt && artifact.cleanupLeaseExpiresAt > now) return null
    const token = randomUUID()
    await tx.dataExportArtifact.update({ where: { id: artifactId }, data: {
      cleanupLeaseToken: token, cleanupLeaseExpiresAt: new Date(now.getTime() + CLEANUP_LEASE_MS),
    } })
    await syncRejectedCleanup(tx, artifact.requestId, userId)
    return { storageKey: artifact.storageKey, outcomeBeforeDelete: artifact.uploadOutcome, token }
  })
  if (!deletion) return
  let deleted = false
  try {
    // The shared storage fragment supplies a bounded, paginated exact-key deletion.
    // Keep one-argument compatibility with the existing T01 data-rights regression.
    await deleteAllVersions(deletion.storageKey)
    deleted = true
  } catch {
    logger.warn({ artifactId, code: 'DATA_EXPORT_CLEANUP_RETRY' }, 'export cleanup remains pending')
  }
  await locked(userId, async (tx, now) => {
    const artifact = await tx.dataExportArtifact.findUnique({ where: { id: artifactId } })
    if (!artifact || artifact.userId !== userId || artifact.state !== 'CLEANUP_REQUIRED' || artifact.cleanupLeaseToken !== deletion.token) return
    // Do not use a later ACK to certify a DELETE which started before that ACK.
    const terminal = deleted && deletion.outcomeBeforeDelete !== 'UNKNOWN'
    await tx.dataExportArtifact.update({ where: { id: artifactId }, data: {
      state: terminal ? 'CLEANED' : 'CLEANUP_REQUIRED', cleanedAt: terminal ? now : null,
      cleanupLeaseToken: null, cleanupLeaseExpiresAt: null,
      cleanupNextAt: terminal ? null : new Date(now.getTime() + CLEANUP_RETRY_MS),
      ...(deleted ? { lastDeleteAt: now } : {}),
    } })
    await syncRejectedCleanup(tx, artifact.requestId, userId)
  })
}

export async function reconcileExportRequest(payload: ExportPayload): Promise<void> {
  const now = await databaseNow()
  const artifacts = await db.dataExportArtifact.findMany({
    where: { ...payload, OR: [
      { state: 'CLEANUP_REQUIRED' },
      { state: { in: [...workingStates] }, leaseExpiresAt: { lte: now } },
    ] }, orderBy: { updatedAt: 'asc' }, take: 20,
  })
  for (const artifact of artifacts) {
    if (await settleDataExport(artifact.id, payload.userId, false, { recoveryOnly: true }) === 'CLEANUP_REQUIRED') await cleanupDataExport(artifact.id, payload.userId)
  }
}

/** Reserve once, then check current publication again immediately before external mail. */
export async function reserveExportNotification(artifactId: string, userId: string): Promise<boolean> {
  return locked(userId, async (tx, now) => {
    const artifact = await tx.dataExportArtifact.findUnique({ where: { id: artifactId } })
    if (!artifact || artifact.userId !== userId || artifact.state !== 'PUBLISHED' || artifact.notificationReservedAt || !artifact.expiresAt || artifact.expiresAt <= now) return false
    const request = await tx.dataRequest.findUnique({ where: { id: artifact.requestId } })
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } })
    if (user?.status !== 'ACTIVE' || request?.userId !== userId || request.status !== 'DONE' || request.resultKey !== artifact.storageKey) return false
    await tx.dataExportArtifact.update({ where: { id: artifactId }, data: { notificationReservedAt: now } })
    return true
  })
}

export async function isExportPublished(artifactId: string, userId: string): Promise<boolean> {
  return locked(userId, async (tx, now) => {
    const artifact = await tx.dataExportArtifact.findUnique({ where: { id: artifactId } })
    if (!artifact || artifact.userId !== userId || artifact.state !== 'PUBLISHED' || !artifact.expiresAt || artifact.expiresAt <= now) return false
    const request = await tx.dataRequest.findUnique({ where: { id: artifact.requestId } })
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } })
    return user?.status === 'ACTIVE' && request?.userId === userId && request.status === 'DONE' && request.resultKey === artifact.storageKey
  })
}

/** Existing scheduler calls this independently of the deleted-user anonymization scan. */
export async function recoverDataExports(): Promise<void> {
  const now = await databaseNow()
  const started = Date.now()
  const artifacts = await db.dataExportArtifact.findMany({ where: { OR: [
    { state: { in: [...workingStates] }, leaseExpiresAt: { lte: now } },
    { state: 'CLEANUP_REQUIRED', OR: [{ cleanupNextAt: null }, { cleanupNextAt: { lte: now } }] },
    { state: 'PUBLISHED', expiresAt: { lte: now } },
  ] }, orderBy: { updatedAt: 'asc' }, take: 20 })
  for (const artifact of artifacts) {
    if (Date.now() - started > 45_000) break
    try {
      if (await settleDataExport(artifact.id, artifact.userId, false, { recoveryOnly: true }) === 'CLEANUP_REQUIRED') await cleanupDataExport(artifact.id, artifact.userId)
    } catch { logger.warn({ artifactId: artifact.id, code: 'DATA_EXPORT_RECOVERY_RETRY' }, 'export recovery remains pending') }
  }
  // Queue-send failure does not lose intent: OPEN and an expired/empty lease remain discoverable.
  const requests = await db.dataRequest.findMany({ where: {
    type: 'EXPORT', status: 'OPEN', user: { status: 'ACTIVE' },
    OR: [{ exportLeaseExpiresAt: null }, { exportLeaseExpiresAt: { lte: now } }],
  }, select: { id: true, userId: true }, orderBy: { createdAt: 'asc' }, take: 25 })
  if (requests.length === 0) return
  await sendBoss.start()
  for (const request of requests) {
    await sendBoss.send('export-user-data', { requestId: request.id, userId: request.userId }, { singletonKey: request.id })
  }
}
