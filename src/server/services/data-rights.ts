import 'server-only'
import { DataRequestStatus, DataRequestType, type Prisma } from '@prisma/client'
import { db } from '../db'
import { logAudit } from './audit'
import { sendBoss } from '../jobs/boss'
import { createNotification } from './notifications'
import { sendNotificationEmail } from './notify'
import { AppError, NotFoundError, ForbiddenError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { logger } from '../lib/logger'
import { invalidateUserExportsTx } from './data-export-artifacts'
import { cancelResumeParseDraftsTx } from './resume-parsing'
import { invalidateStudentMatchingIndexTx } from './semantic-matching'

const EXPORT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000

async function lifecycleClockTx(tx: Prisma.TransactionClient, userId: string): Promise<Date> {
  await lockXact(tx, LOCK_NS.STUDENT_DATA, userId)
  await lockXact(tx, LOCK_NS.DATA_EXPORT, userId)
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`
  if (!clock) throw new AppError('Data request clock unavailable', 'INTERNAL_ERROR', 500)
  return clock.now
}

/** Caller holds STUDENT_DATA -> DATA_EXPORT. Preserve only pre-ledger cleanup references. */
export async function invalidateLifecycleExportsTx(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const candidates = await tx.dataRequest.findMany({
    where: { userId, type: 'EXPORT', resultKey: { not: null } }, select: { id: true, resultKey: true, note: true },
  })
  const legacy = []
  for (const request of candidates) {
    if (!request.resultKey) continue
    const artifact = await tx.dataExportArtifact.findUnique({ where: { storageKey: request.resultKey }, select: { id: true } })
    if (!artifact) legacy.push({ id: request.id, resultKey: request.resultKey, note: request.note })
  }
  await invalidateUserExportsTx(tx, userId)
  // These historical keys never authorize download/PUT. Keeping each original
  // request reference prevents a pre-ledger object from disappearing from cleanup.
  for (const request of legacy) await tx.dataRequest.updateMany({
    where: { id: request.id, userId, type: 'EXPORT' }, data: { resultKey: request.resultKey, note: request.note },
  })
}

/** Request a data export; only a live published artifact can satisfy a DONE dedupe hit. */
export async function requestExport(ctx: { userId: string }): Promise<{ requestId: string; existing: boolean }> {
  const result = await db.$transaction(async tx => {
    const now = await lifecycleClockTx(tx, ctx.userId)
    const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { status: true } })
    if (!user) throw new NotFoundError('User not found')
    if (user.status !== 'ACTIVE') throw new ForbiddenError()
    const since = new Date(now.getTime() - EXPORT_DEDUP_WINDOW_MS)
    const candidates = await tx.dataRequest.findMany({
      where: { userId: ctx.userId, type: DataRequestType.EXPORT, OR: [
        { status: DataRequestStatus.OPEN }, { status: DataRequestStatus.DONE, resolvedAt: { gte: since } },
      ] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    for (const existing of candidates) {
      if (existing.status === 'OPEN' && !existing.resultKey) return { requestId: existing.id, existing: true }
      if (!existing.resultKey) continue
      const artifact = await tx.dataExportArtifact.findUnique({ where: { storageKey: existing.resultKey } })
      if (existing.status === 'OPEN') {
        if (artifact?.requestId === existing.id && artifact.userId === ctx.userId) return { requestId: existing.id, existing: true }
        // Expire a pre-ledger fixed-key intent without losing its cleanup pointer.
        await tx.dataRequest.update({ where: { id: existing.id }, data: {
          status: 'REJECTED', exportGeneration: { increment: 1 }, exportLeaseToken: null, exportLeaseExpiresAt: null, resolvedAt: now,
        } })
        continue
      }
      if (artifact && artifact.requestId === existing.id && artifact.userId === ctx.userId &&
        artifact.state === 'PUBLISHED' && artifact.uploadOutcome === 'ACKNOWLEDGED' &&
        artifact.generation === existing.exportGeneration && artifact.expiresAt && artifact.expiresAt > now) {
        return { requestId: existing.id, existing: true }
      }
    }
    const request = await tx.dataRequest.create({ data: { userId: ctx.userId, type: DataRequestType.EXPORT } })
    await logAudit({ actorId: ctx.userId, action: 'data.export', targetType: 'DataRequest', targetId: request.id }, tx)
    return { requestId: request.id, existing: false }
  })
  if (!result.existing) {
    try {
      await sendBoss.start()
      await sendBoss.send('export-user-data', { requestId: result.requestId, userId: ctx.userId })
    } catch {
      // Durable OPEN intent is recovered by the artifact protocol's independent scanner.
      logger.warn({ code: 'DATA_EXPORT_DISPATCH_PENDING' }, 'Data export dispatch remains pending')
    }
  }
  return result
}

/** Keep the existing retention and notification flow, with lifecycle invalidation committed atomically. */
export async function requestDeletion(ctx: { userId: string }): Promise<void> {
  const changed = await db.$transaction(async tx => {
    const now = await lifecycleClockTx(tx, ctx.userId)
    const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { status: true } })
    if (!user) throw new NotFoundError('User not found')
    await invalidateLifecycleExportsTx(tx, ctx.userId)
    await cancelResumeParseDraftsTx(tx, ctx.userId)
    await invalidateStudentMatchingIndexTx(tx, ctx.userId)
    // Repeated deletion still repairs pending invalidation, but never renews the 30-day clock.
    if (user.status === 'DELETED') return false
    await tx.user.update({ where: { id: ctx.userId }, data: { status: 'DELETED', deletedAt: now } })
    await tx.studentProfile.updateMany({ where: { userId: ctx.userId }, data: { visibility: 'HIDDEN', editRevision: { increment: 1 } } })
    await tx.session.deleteMany({ where: { userId: ctx.userId } })
    const request = await tx.dataRequest.create({ data: {
      userId: ctx.userId, type: DataRequestType.DELETE, status: DataRequestStatus.DONE, resolvedAt: now,
    } })
    await logAudit({ actorId: ctx.userId, action: 'data.delete', targetType: 'DataRequest', targetId: request.id }, tx)
    await createNotification(tx, ctx.userId, 'account.deletion.confirmed', { requestId: request.id })
    return true
  })
  if (changed) await sendNotificationEmail(ctx.userId, { template: 'account-deletion-confirmed' })
}

/** Owner-only ACTIVE + exact PUBLISHED authorization. Signing still occurs after this transaction. */
export async function getExportDownloadRequest(ctx: { userId: string }, requestId: string) {
  return db.$transaction(async tx => {
    const now = await lifecycleClockTx(tx, ctx.userId)
    const req = await tx.dataRequest.findUnique({
      where: { id: requestId },
      select: { id: true, userId: true, type: true, status: true, resultKey: true, resolvedAt: true, exportGeneration: true },
    })
    if (!req || req.userId !== ctx.userId || req.type !== DataRequestType.EXPORT) throw new NotFoundError('Export not found')
    const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { status: true } })
    if (user?.status !== 'ACTIVE') return null
    if (req.status !== DataRequestStatus.DONE || !req.resultKey || !req.resolvedAt) return null
    if (now.getTime() - req.resolvedAt.getTime() >= EXPORT_DEDUP_WINDOW_MS) throw new NotFoundError('Export expired')
    const artifact = await tx.dataExportArtifact.findUnique({ where: { storageKey: req.resultKey } })
    if (!artifact || artifact.userId !== ctx.userId || artifact.requestId !== req.id || artifact.state !== 'PUBLISHED' ||
      artifact.uploadOutcome !== 'ACKNOWLEDGED' || artifact.generation !== req.exportGeneration || !artifact.expiresAt || artifact.expiresAt <= now) return null
    // Preserve the pre-existing public return shape without ledger/lease metadata.
    return { id: req.id, userId: req.userId, type: req.type, status: req.status, resultKey: req.resultKey, resolvedAt: req.resolvedAt }
  })
}

/** List all data requests for admin. */
export async function listDataRequestsForAdmin(opts: {
  status?: DataRequestStatus
  cursor?: string
  limit?: number
}) {
  const take = opts.limit ?? 20
  const rows = await db.dataRequest.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  })

  const hasMore = rows.length > take
  return { rows: rows.slice(0, take), hasMore, nextCursor: hasMore ? rows[take - 1]?.id : null }
}

/** Resolve (DONE or REJECTED) a CORRECT request. Only admin. */
export async function resolveDataRequest(
  ctx: { userId: string },
  input: { requestId: string; resolution: 'DONE' | 'REJECTED'; note?: string },
): Promise<void> {
  const req = await db.dataRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, type: true, status: true, userId: true },
  })

  if (!req) throw new NotFoundError('Request not found')
  if (req.type !== DataRequestType.CORRECT) throw new ForbiddenError()
  if (req.status !== DataRequestStatus.OPEN) throw new ForbiddenError()

  await db.$transaction(async (tx) => {
    await tx.dataRequest.update({
      where: { id: req.id },
      data: {
        status: input.resolution === 'DONE' ? DataRequestStatus.DONE : DataRequestStatus.REJECTED,
        note: input.note ?? null,
        resolvedAt: new Date(),
      },
    })

    await logAudit(
      {
        actorId: ctx.userId,
        action: 'data.export',
        targetType: 'DataRequest',
        targetId: req.id,
        metadata: { resolution: input.resolution, note: input.note },
      },
      tx,
    )
  })
}
