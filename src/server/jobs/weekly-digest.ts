import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Prisma, WeeklyDigestDelivery } from '@prisma/client'
import { db } from '../db'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { getWeeklyDigestWindow, nextWeeklyDigestCapAttempt, weeklyDigestKey } from '../lib/weekly-digest'
import { recommendJobs, recommendTalents } from '../services/semantic-matching'
import { sendWeeklyDigestEmail } from '../services/notify'
import { contextMatches, contextMetadata, loadWeeklyContextTx, type Cohort } from '../services/weekly-digest-data'
import { sendBoss } from './boss'

const payloadSchema = z.object({ deliveryId: z.string().cuid() }).strict()
const recommendationSchema = z.object({ availability: z.enum(['ready', 'unavailable']), items: z.array(z.object({ id: z.string().cuid() }).passthrough()).max(5) })
const due = (now: Date): Prisma.WeeklyDigestDeliveryWhereInput => ({ OR: [
  { state: 'QUEUED' }, { state: 'RETRYABLE', nextAttemptAt: { lte: now } }, { state: 'PREPARING', leaseExpiresAt: { lte: now } },
] })
const pendingWeeklyWork = new Set<Promise<unknown>>()
export async function drainWeeklyDigestWork(): Promise<void> {
  while (pendingWeeklyWork.size) await Promise.allSettled([...pendingWeeklyWork])
}
function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  pendingWeeklyWork.add(work)
  void work.then(() => pendingWeeklyWork.delete(work), () => pendingWeeklyWork.delete(work))
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Weekly deadline exceeded')), milliseconds) })])
    .finally(() => clearTimeout(timer))
}
type WeeklyQueuePort = (payload: { deliveryId: string }) => Promise<unknown>
type WeeklyScheduleOptions = { now?: Date; signal?: AbortSignal; send?: WeeklyQueuePort }
async function enqueue(deliveryId: string, send?: WeeklyQueuePort): Promise<boolean> {
  // Registry supplies its already-started boss. Its send is owned until actual settlement.
  if (send) {
    try { const id = await send({ deliveryId }); return typeof id === 'string' && id.length > 0 }
    catch { return false }
  }
  const deadline = Date.now() + 2000
  try {
    return await bounded((async () => {
      await sendBoss.start()
      if (Date.now() >= deadline) return false
      const id = await sendBoss.send('weekly-digest', { deliveryId })
      return typeof id === 'string' && id.length > 0
    })(), 2000)
  } catch { return false }
}

export async function scheduleWeeklyDigests(options?: WeeklyScheduleOptions): Promise<{ queued: number; skipped: number }> {
  const now = options?.now ?? new Date(), window = getWeeklyDigestWindow(now)
  let queued = 0, skipped = 0, cursor: string | undefined
  // Cursor pages bound memory while retaining a deterministic cohort scan.
  for (;;) {
    if (options?.signal?.aborted) break
    const users = await db.user.findMany({ where: { status: 'ACTIVE', emailVerified: true, role: { in: ['STUDENT', 'EMPLOYER'] } },
      orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, role: true } })
    if (!users.length) break
    for (const user of users) {
      if (options?.signal?.aborted) break
      const cohorts: Cohort[] = user.role === 'STUDENT' ? [{ kind: 'STUDENT_JOBS', userId: user.id, companyId: null }]
        : (await db.companyMember.findMany({ where: { userId: user.id, role: 'OWNER', company: { isActive: true, verificationStatus: 'VERIFIED' } },
          orderBy: { companyId: 'asc' }, select: { companyId: true } })).map(member => ({ kind: 'EMPLOYER_TALENTS', userId: user.id, companyId: member.companyId }))
      for (const cohort of cohorts) {
        if (options?.signal?.aborted) break
        const id = await db.$transaction(async tx => {
          await lockXact(tx, LOCK_NS.MARKETING, cohort.userId)
          const context = await loadWeeklyContextTx(tx, cohort)
          if (!context) return null
          const dedupeKey = weeklyDigestKey({ ...cohort, weekKey: window.weekKey })
          const inserted = await tx.weeklyDigestDelivery.createMany({ skipDuplicates: true, data: [{
            ...cohort, ...contextMetadata(context), dedupeKey, weekKey: window.weekKey, expiresAt: window.expiresAt, candidateIds: [],
          }] })
          if (!inserted.count) return null
          return (await tx.weeklyDigestDelivery.findUniqueOrThrow({ where: { dedupeKey }, select: { id: true } })).id
        })
        if (!id) { skipped++; continue }
        // The row is durable before queue I/O. Recovery handles a failed send.
        if (!options?.signal?.aborted) await enqueue(id, options?.send)
        queued++
      }
    }
    cursor = users[users.length - 1].id
  }
  return { queued, skipped }
}

export async function recoverWeeklyDigests(options?: WeeklyScheduleOptions): Promise<{ queued: number; unknown: number }> {
  if (options?.signal?.aborted) return { queued: 0, unknown: 0 }
  const now = options?.now ?? new Date(), window = getWeeklyDigestWindow(now)
  const unknown = await db.weeklyDigestDelivery.updateMany({ where: { state: 'SENDING', OR: [{ leaseExpiresAt: { lte: now } }, { expiresAt: { lte: now } }] },
    data: { state: 'UNKNOWN', failureCode: 'OUTCOME_UNKNOWN', leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null, candidateIds: [] } })
  await db.weeklyDigestDelivery.updateMany({ where: { state: { in: ['QUEUED', 'PREPARING', 'RETRYABLE'] },
    OR: [{ expiresAt: { lte: now } }, { attempts: { gte: 3 }, NOT: { state: 'PREPARING', leaseExpiresAt: { gt: now } } }] },
  data: { state: 'SKIPPED', failureCode: 'WINDOW_OR_ATTEMPTS_EXHAUSTED', leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null, candidateIds: [] } })
  const rows = await db.weeklyDigestDelivery.findMany({ where: { AND: [due(now), { weekKey: window.weekKey, expiresAt: { gt: now }, attempts: { lt: 3 } }] },
    orderBy: { id: 'asc' }, take: 200, select: { id: true } })
  let queued = 0
  for (const row of rows) {
    if (options?.signal?.aborted) break
    if (await enqueue(row.id, options?.send)) queued++
  }
  return { queued, unknown: unknown.count }
}

async function claim(deliveryId: string): Promise<WeeklyDigestDelivery | null> {
  const owner = await db.weeklyDigestDelivery.findUnique({ where: { id: deliveryId }, select: { userId: true } })
  if (!owner) return null
  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.MARKETING, owner.userId)
    const now = new Date(), leaseToken = randomUUID()
    const changed = await tx.weeklyDigestDelivery.updateMany({ where: { AND: [due(now), { id: deliveryId,
      weekKey: getWeeklyDigestWindow(now).weekKey, expiresAt: { gt: now }, attempts: { lt: 3 } }] },
    data: { state: 'PREPARING', attempts: { increment: 1 }, leaseToken, leaseExpiresAt: new Date(now.getTime() + 120_000), nextAttemptAt: null, failureCode: null, candidateIds: [] } })
    return changed.count === 1 ? tx.weeklyDigestDelivery.findUnique({ where: { id: deliveryId } }) : null
  })
}
async function finish(row: WeeklyDigestDelivery, state: 'SENT' | 'SKIPPED' | 'RETRYABLE' | 'UNKNOWN', failureCode: string | null, delayMs = 60_000): Promise<void> {
  const now = new Date(), nextAttemptAt = failureCode === 'EMAIL_CAP' ? nextWeeklyDigestCapAttempt(now) : new Date(now.getTime() + delayMs)
  const exhausted = state === 'RETRYABLE' && (row.attempts >= 3 || nextAttemptAt >= row.expiresAt)
  await db.weeklyDigestDelivery.updateMany({ where: { id: row.id, leaseToken: row.leaseToken,
    state: { in: state === 'SENT' || state === 'UNKNOWN' ? ['SENDING'] : ['PREPARING', 'SENDING'] } },
  data: { state: exhausted ? 'SKIPPED' : state, failureCode: exhausted ? 'WINDOW_OR_ATTEMPTS_EXHAUSTED' : failureCode,
    sentAt: state === 'SENT' ? now : null, nextAttemptAt: state === 'RETRYABLE' && !exhausted ? nextAttemptAt : null,
    leaseToken: null, leaseExpiresAt: null, candidateIds: [] } })
}

export async function runWeeklyDigest(raw: { deliveryId: string }, options?: { signal?: AbortSignal }): Promise<void> {
  const payload = payloadSchema.safeParse(raw)
  if (!payload.success || options?.signal?.aborted) return
  const row = await claim(payload.data.deliveryId)
  if (!row) return
  try {
    const context = await db.$transaction(async tx => {
      await lockXact(tx, LOCK_NS.MARKETING, row.userId)
      const current = await tx.weeklyDigestDelivery.findUnique({ where: { id: row.id }, select: { state: true, leaseToken: true, leaseExpiresAt: true } })
      if (!current || current.state !== 'PREPARING' || current.leaseToken !== row.leaseToken || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date()) return null
      return loadWeeklyContextTx(tx, row, row.sourceId)
    })
    if (!context || !contextMatches(row, context)) { await finish(row, 'SKIPPED', 'AUTHORIZATION_CHANGED'); return }
    if (options?.signal?.aborted) { await finish(row, 'RETRYABLE', 'PREPARATION_CANCELLED'); return }
    const recommendation = await bounded<unknown>(row.kind === 'STUDENT_JOBS'
      ? recommendJobs({ userId: row.userId }, { limit: 5 })
      : recommendTalents({ userId: row.userId, companyId: row.companyId! }, { jobId: row.sourceId, limit: 5 }), 90_000)
    const parsed = recommendationSchema.safeParse(recommendation)
    if (!parsed.success || parsed.data.availability === 'unavailable') { await finish(row, 'RETRYABLE', 'RECOMMENDATIONS_UNAVAILABLE'); return }
    const ids = [...new Set(parsed.data.items.map(item => item.id))]
    if (!ids.length) { await finish(row, 'SKIPPED', 'NO_CURRENT_ROWS'); return }
    if (options?.signal?.aborted) { await finish(row, 'RETRYABLE', 'PREPARATION_CANCELLED'); return }
    const recorded = await db.$transaction(async tx => {
      await lockXact(tx, LOCK_NS.MARKETING, row.userId)
      const latest = await loadWeeklyContextTx(tx, row, row.sourceId)
      if (!latest || !contextMatches(row, latest)) return false
      const changed = await tx.weeklyDigestDelivery.updateMany({ where: { id: row.id, state: 'PREPARING', leaseToken: row.leaseToken, leaseExpiresAt: { gt: new Date() } }, data: { candidateIds: ids } })
      return changed.count === 1
    })
    if (!recorded) { await finish(row, 'SKIPPED', 'AUTHORIZATION_CHANGED'); return }
    const sent = await sendWeeklyDigestEmail({ deliveryId: row.id, leaseToken: row.leaseToken! })
    if (sent.status === 'accepted') await finish(row, 'SENT', null)
    else if (sent.status === 'unknown') await finish(row, 'UNKNOWN', 'OUTCOME_UNKNOWN')
    else if (sent.status === 'suppressed') await finish(row, 'SKIPPED', 'AUTHORIZATION_CHANGED')
    else await finish(row, 'RETRYABLE', sent.reason === 'cap' ? 'EMAIL_CAP' : 'PROVIDER_NOT_ACCEPTED')
  } catch {
    // Do not log provider error objects, tokens or recipient addresses. A failure
    // after SENDING (including a lost SENT database ACK) is never retryable.
    const latest = await db.weeklyDigestDelivery.findUnique({ where: { id: row.id }, select: { state: true, leaseToken: true } }).catch(() => null)
    if (latest?.leaseToken === row.leaseToken) {
      await finish(row, latest.state === 'SENDING' ? 'UNKNOWN' : 'RETRYABLE', latest.state === 'SENDING' ? 'OUTCOME_UNKNOWN' : 'PREPARATION_FAILED').catch(() => {})
    }
  }
}
