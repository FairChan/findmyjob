import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { AppError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { logger } from '../lib/logger'
import { createNotification } from '../services/notifications'
import { resolveCompanyEntitlements } from '../services/subscription-entitlements'

const BATCH_SIZE = 50
const REMINDER_WINDOW_MS = 7 * 86_400_000

async function processCompany(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await lockXact(tx, LOCK_NS.CREDIT, companyId)
  const now = new Date()
  await tx.subscription.updateMany({
    where: { companyId, status: 'ACTIVE', endsAt: { lte: now } }, data: { status: 'EXPIRED' },
  })
  const company = await tx.company.findUnique({ where: { id: companyId }, select: { isActive: true } })
  if (!company?.isActive) return
  let tail = await resolveCompanyEntitlements(tx, { companyId, now })
  if (tail.source !== 'SUBSCRIPTION' || !tail.effectiveUntil || !tail.subscriptionId) return
  const windowEnd = now.getTime() + REMINDER_WINDOW_MS
  // Follow only validated, exactly adjacent paid segments. A gap cannot suppress a reminder.
  while (tail.effectiveUntil && tail.effectiveUntil.getTime() <= windowEnd) {
    const next = await resolveCompanyEntitlements(tx, { companyId, now: tail.effectiveUntil })
    if (next.source !== 'SUBSCRIPTION' || next.planId !== tail.planId
      || next.effectiveFrom?.getTime() !== tail.effectiveUntil.getTime()) break
    if (!next.effectiveUntil || next.effectiveUntil.getTime() <= tail.effectiveUntil.getTime()) break
    tail = next
  }
  if (!tail.subscriptionId || !tail.effectiveUntil || tail.effectiveUntil.getTime() > windowEnd) return
  const subscription = await tx.subscription.findUnique({ where: { id: tail.subscriptionId }, select: { expiryReminderAt: true } })
  if (!subscription || subscription.expiryReminderAt !== null) return
  const owner = await tx.companyMember.findFirst({
    where: { companyId, role: 'OWNER', user: { status: 'ACTIVE', role: 'EMPLOYER' } },
    orderBy: { id: 'asc' }, select: { userId: true },
  })
  if (!owner) {
    logger.info({ companyId, subscriptionId: tail.subscriptionId }, 'Subscription reminder has no active owner')
    return
  }
  await createNotification(tx, owner.userId, 'subscription.expiring', {
    subscriptionId: tail.subscriptionId, endsAt: tail.effectiveUntil.toISOString(),
  })
  await tx.subscription.update({ where: { id: tail.subscriptionId }, data: { expiryReminderAt: now } })
}

export async function runExpireSubscriptions(): Promise<void> {
  let cursor: string | undefined
  let failed = false
  while (true) {
    const companies = await db.company.findMany({
      where: { ...(cursor ? { id: { gt: cursor } } : {}), subscriptions: { some: { status: 'ACTIVE' } } },
      orderBy: { id: 'asc' }, take: BATCH_SIZE, select: { id: true },
    })
    if (companies.length === 0) break
    for (const company of companies) {
      try {
        await db.$transaction(tx => processCompany(tx, company.id), { maxWait: 10_000, timeout: 15_000 })
      } catch {
        failed = true
        logger.error({ companyId: company.id }, 'Subscription expiry processing failed')
      }
    }
    cursor = companies[companies.length - 1].id
    if (companies.length < BATCH_SIZE) break
  }
  if (failed) throw new AppError('Subscription expiry processing failed', 'SUBSCRIPTION_JOB_FAILED', 503)
}
