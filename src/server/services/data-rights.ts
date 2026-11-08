import 'server-only'
import { DataRequestStatus, DataRequestType } from '@prisma/client'
import { db } from '../db'
import { logAudit } from './audit'
import { sendBoss } from '../jobs/boss'
import { createNotification } from './notifications'
import { sendNotificationEmail } from './notify'
import { NotFoundError, ForbiddenError } from '../errors'

const EXPORT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000

/** Request a data export. If the user already has an OPEN or recently DONE export, return it. */
export async function requestExport(ctx: { userId: string }): Promise<{ requestId: string; existing: boolean }> {
  const since = new Date(Date.now() - EXPORT_DEDUP_WINDOW_MS)

  const existing = await db.dataRequest.findFirst({
    where: {
      userId: ctx.userId,
      type: DataRequestType.EXPORT,
      OR: [
        { status: DataRequestStatus.OPEN },
        { status: DataRequestStatus.DONE, resolvedAt: { gte: since } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  })

  if (existing) {
    return { requestId: existing.id, existing: true }
  }

  const req = await db.$transaction(async (tx) => {
    const r = await tx.dataRequest.create({
      data: { userId: ctx.userId, type: DataRequestType.EXPORT },
    })
    await logAudit(
      { actorId: ctx.userId, action: 'data.export', targetType: 'DataRequest', targetId: r.id },
      tx,
    )
    return r
  })

  await sendBoss.start()
  await sendBoss.send('export-user-data', { requestId: req.id, userId: ctx.userId })

  return { requestId: req.id, existing: false }
}

/** Soft-delete the account. Immediately removes from talent pool, revokes sessions, creates DataRequest(DELETE). */
export async function requestDeletion(ctx: { userId: string }): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: ctx.userId },
    select: { id: true, status: true },
  })
  if (!user) throw new NotFoundError('User not found')
  if (user.status === 'DELETED') return

  const req = await db.$transaction(async (tx) => {
    // Soft-delete
    await tx.user.update({
      where: { id: ctx.userId },
      data: { status: 'DELETED', deletedAt: new Date() },
    })

    // Remove from talent pool immediately
    await tx.studentProfile.updateMany({
      where: { userId: ctx.userId },
      data: { visibility: 'HIDDEN' },
    })

    // Revoke all sessions
    await tx.session.deleteMany({ where: { userId: ctx.userId } })

    // Create DataRequest(DELETE)
    const r = await tx.dataRequest.create({
      data: { userId: ctx.userId, type: DataRequestType.DELETE, status: DataRequestStatus.DONE, resolvedAt: new Date() },
    })

    await logAudit(
      { actorId: ctx.userId, action: 'data.delete', targetType: 'DataRequest', targetId: r.id },
      tx,
    )

    // In-transaction notification (no email here — email sent after commit)
    await createNotification(tx, ctx.userId, 'account.deletion.confirmed', {
      requestId: r.id,
    })

    return r
  })

  // Post-commit email
  await sendNotificationEmail(ctx.userId, { template: 'account-deletion-confirmed' })
}

/** Get a completed export request belonging to the user, if still within 24 hours. */
export async function getExportDownloadRequest(ctx: { userId: string }, requestId: string) {
  const req = await db.dataRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      resultKey: true,
      resolvedAt: true,
    },
  })

  if (!req || req.userId !== ctx.userId || req.type !== DataRequestType.EXPORT) {
    throw new NotFoundError('Export not found')
  }

  if (req.status !== DataRequestStatus.DONE || !req.resultKey || !req.resolvedAt) {
    return null
  }

  const age = Date.now() - req.resolvedAt.getTime()
  if (age > EXPORT_DEDUP_WINDOW_MS) {
    throw new NotFoundError('Export expired')
  }

  return req
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
