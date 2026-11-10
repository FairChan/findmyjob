import 'server-only'
import { createHash } from 'node:crypto'

export function getWeeklyDigestWindow(now: Date): { weekKey: string; startsAt: Date; expiresAt: Date } {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid weekly clock')
  const offset = 8 * 60 * 60 * 1000, day = 24 * 60 * 60 * 1000
  const local = new Date(now.getTime() + offset)
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - ((local.getUTCDay() + 6) % 7) * day
  return { weekKey: new Date(monday).toISOString().slice(0, 10), startsAt: new Date(monday - offset), expiresAt: new Date(monday - offset + 7 * day) }
}

export function weeklyDigestKey(input: { kind: 'STUDENT_JOBS' | 'EMPLOYER_TALENTS'; userId: string; companyId: string | null; weekKey: string }): string {
  return createHash('sha256').update(JSON.stringify([input.kind, input.userId, input.companyId, input.weekKey])).digest('hex')
}

export function nextWeeklyDigestCapAttempt(now: Date): Date {
  // The existing global cap is a rolling daily bucket, not a KL-midnight reset.
  return new Date(now.getTime() + 24 * 60 * 60 * 1000)
}
