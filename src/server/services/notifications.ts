import 'server-only'
import {
  toTalentCard,
  type ProfileCardInput,
  type TalentCard,
} from '@/server/serializers/talent-card'
import { db } from '../db'

export interface NotificationItem {
  id: string
  type: string
  payload: Record<string, unknown>
  readAt: Date | null
  createdAt: Date
}

export async function listNotifications(
  ctx: { userId: string },
  opts: { limit?: number } = {},
): Promise<NotificationItem[]> {
  const rows = await db.notification.findMany({
    where: { userId: ctx.userId },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 50,
    select: { id: true, type: true, payload: true, readAt: true, createdAt: true },
  })
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: r.payload as Record<string, unknown>,
    readAt: r.readAt,
    createdAt: r.createdAt,
  }))
}

/** 只改调用者自己的未读通知；别人的 id 混进来也只会被 where 过滤掉 */
export async function markNotificationsRead(ctx: { userId: string }, ids: string[]): Promise<number> {
  const res = await db.notification.updateMany({
    where: { userId: ctx.userId, id: { in: ids }, readAt: null },
    data: { readAt: new Date() },
  })
  return res.count
}

export async function markAllNotificationsRead(ctx: { userId: string }): Promise<void> {
  await db.notification.updateMany({
    where: { userId: ctx.userId, readAt: null },
    data: { readAt: new Date() },
  })
}

export interface NotificationWriter {
  notification: {
    create: (args: { data: { userId: string; type: string; payload: any } }) => Promise<unknown>
  }
}

export async function createNotification(
  tx: NotificationWriter,
  userId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.notification.create({ data: { userId, type, payload } })
}

/**
 * Builds the payload for employer-facing notifications about a student.
 * The payload is always generated with unlocked=false so free-text fields are
 * PII-safe. The caller is responsible for determining canSeeName:
 *   - true  when a TalentUnlock record exists, the student has not blocked the
 *           company, and the account is not deleted (implemented in M4-T08).
 *   - false otherwise.
 * Note: Notification.payload is a snapshot at send time; a later block or
 * account deletion does not retroactively redact names already stored
 * (accepted risk — purge-deleted-accounts in M7-T03 cleans up deleted users).
 */
export function buildEmployerStudentPayload(
  profile: ProfileCardInput,
  opts: { canSeeName: boolean },
): TalentCard {
  const card = toTalentCard(profile, { unlocked: false })
  if (opts.canSeeName) {
    return { ...card, name: profile.fullName }
  }
  return card
}
