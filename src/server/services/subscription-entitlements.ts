import 'server-only'
import type { JobStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { AppError, ValidationError } from '../errors'
import { logger } from '../lib/logger'
import { commercialSnapshotSchema } from './billing'
import { createPlanSchema } from './admin-plans'
import { getSetting } from './settings'
export { getCompanyEntitlementUsage } from './company-entitlement-usage'
export type { CompanyEntitlementUsage } from './company-entitlement-usage'

export type EntitlementLimit = number | null

export interface CompanyEntitlements {
  source: 'SUBSCRIPTION' | 'FREE' | 'PILOT'
  subscriptionId: string | null
  orderId: string | null
  planId: string | null
  planCode: string
  effectiveFrom: Date | null
  effectiveUntil: Date | null
  jobPostLimit: EntitlementLimit
  seatLimit: EntitlementLimit
  invitationQuota: EntitlementLimit
  fallbackReason: 'NONE' | 'NO_ACTIVE_SUBSCRIPTION' | 'INVALID_SNAPSHOT' | 'OVERLAP'
}

export interface EntitlementInput {
  companyId: string
  now: Date
}

const finiteLimit = z.number().int().min(0).max(2_147_483_647)
const finiteSeats = finiteLimit.min(1)
const FREE_LIMITS = { jobPostLimit: 2, seatLimit: 3, invitationQuota: 20 } as const

function assertNow(now: Date): void {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ValidationError('Invalid entitlement time')
}

function warn(companyId: string, reason: string): void {
  logger.warn({ companyId, reason }, 'Subscription entitlement fallback')
}

async function baseEntitlements(
  tx: Prisma.TransactionClient, companyId: string, reason: CompanyEntitlements['fallbackReason'],
): Promise<CompanyEntitlements> {
  const enabled = await getSetting<unknown>('billing.enabled', false, { tx, fresh: true })
  const base = {
    subscriptionId: null, orderId: null, planId: null,
    effectiveFrom: null, effectiveUntil: null, fallbackReason: reason,
  }
  if (enabled === false) {
    const [seats, invitations] = await Promise.all([
      getSetting<unknown>('team.maxMembers', FREE_LIMITS.seatLimit, { tx, fresh: true }),
      getSetting<unknown>('invitations.freeMonthlyQuota', FREE_LIMITS.invitationQuota, { tx, fresh: true }),
    ])
    const seat = finiteSeats.safeParse(seats)
    const invitation = finiteLimit.safeParse(invitations)
    if (!seat.success || !invitation.success) warn(companyId, 'INVALID_PILOT_SETTINGS')
    return {
      ...base, source: 'PILOT', planCode: 'PILOT', jobPostLimit: null,
      seatLimit: seat.success ? seat.data : FREE_LIMITS.seatLimit,
      invitationQuota: invitation.success ? invitation.data : FREE_LIMITS.invitationQuota,
    }
  }
  // An invalid flag must not accidentally enable the unlimited pilot job allowance.
  if (enabled !== true) warn(companyId, 'INVALID_BILLING_FLAG')
  const free = await tx.plan.findUnique({ where: { code: 'FREE' } })
  const parsed = createPlanSchema.safeParse(free)
  if (!free || !parsed.success || parsed.data.code !== 'FREE'
    || parsed.data.jobPostLimit === null || parsed.data.seatLimit === null || parsed.data.invitationQuota === null) {
    warn(companyId, 'INVALID_FREE_PLAN')
    return { ...base, source: 'FREE', planCode: 'FREE', ...FREE_LIMITS }
  }
  return {
    ...base, source: 'FREE', planId: free.id, planCode: 'FREE',
    jobPostLimit: parsed.data.jobPostLimit, seatLimit: parsed.data.seatLimit, invitationQuota: parsed.data.invitationQuota,
  }
}

/** Caller owns its transaction and CREDIT lock; now must be sampled after acquiring the lock. */
export async function resolveCompanyEntitlements(
  tx: Prisma.TransactionClient, input: EntitlementInput,
): Promise<CompanyEntitlements> {
  assertNow(input.now)
  const candidates = await tx.subscription.findMany({
    where: { companyId: input.companyId, status: 'ACTIVE', startsAt: { lte: input.now }, endsAt: { gt: input.now } },
    include: { order: true }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 2,
  })
  if (candidates.length === 0) return baseEntitlements(tx, input.companyId, 'NO_ACTIVE_SUBSCRIPTION')
  if (candidates.length > 1) {
    warn(input.companyId, 'OVERLAP')
    return baseEntitlements(tx, input.companyId, 'OVERLAP')
  }
  const subscription = candidates[0]
  const order = subscription.order
  const parsed = commercialSnapshotSchema.safeParse(order?.commercialSnapshot)
  if (!order || !parsed.success || order.companyId !== input.companyId || order.status !== 'PAID'
    || order.kind !== 'PLAN' || order.planId !== subscription.planId
    || parsed.data.plan.id !== subscription.planId || parsed.data.plan.kind !== 'PLAN'
    || parsed.data.money.payableSen !== order.amountSen || parsed.data.money.discountSen !== order.discountSen
    || parsed.data.money.currency !== order.currency || parsed.data.delivery.subscription === null
    || subscription.endsAt.getTime() <= subscription.startsAt.getTime()) {
    warn(input.companyId, 'INVALID_SNAPSHOT')
    return baseEntitlements(tx, input.companyId, 'INVALID_SNAPSHOT')
  }
  const terms = parsed.data.delivery.subscription
  return {
    source: 'SUBSCRIPTION', subscriptionId: subscription.id, orderId: order.id,
    planId: subscription.planId, planCode: parsed.data.plan.code,
    effectiveFrom: subscription.startsAt, effectiveUntil: subscription.endsAt,
    jobPostLimit: terms.jobPostLimit, seatLimit: terms.seatLimit, invitationQuota: terms.invitationQuota,
    fallbackReason: 'NONE',
  }
}

export function consumesJobSlot(job: { status: JobStatus; deadline: Date | null }, now: Date): boolean {
  assertNow(now)
  return job.status === 'PUBLISHED' && (job.deadline === null || job.deadline.getTime() > now.getTime())
}

/** Call only for a false -> true slot transition, inside the caller's CREDIT transaction. */
export async function assertJobCapacity(tx: Prisma.TransactionClient, input: EntitlementInput): Promise<void> {
  const { jobPostLimit } = await resolveCompanyEntitlements(tx, input)
  if (jobPostLimit === null) return
  const used = await tx.job.count({
    where: { companyId: input.companyId, status: 'PUBLISHED', OR: [{ deadline: null }, { deadline: { gt: input.now } }] },
  })
  if (used >= jobPostLimit) throw new AppError('Published job limit reached', 'JOB_POST_LIMIT_EXCEEDED', 409)
}

/** Accepting a reserved invite counts members only; creating one also counts ordinary reservations. */
export async function assertSeatCapacity(
  tx: Prisma.TransactionClient, input: EntitlementInput & { includePendingInvites?: boolean },
): Promise<void> {
  const { seatLimit } = await resolveCompanyEntitlements(tx, input)
  if (seatLimit === null) return
  const members = await tx.companyMember.count({ where: { companyId: input.companyId } })
  const pending = input.includePendingInvites ? await tx.companyInvite.count({
    where: {
      companyId: input.companyId, role: { in: ['ADMIN', 'RECRUITER'] },
      acceptedAt: null, expiresAt: { gt: input.now },
    },
  }) : 0
  if (members + pending >= seatLimit) throw new AppError('Team seat limit reached', 'SEAT_LIMIT_EXCEEDED', 409)
}
