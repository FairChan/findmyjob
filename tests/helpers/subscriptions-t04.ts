import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type Job, type Subscription } from '@prisma/client'
import { expect } from 'vitest'
import type { CompanyCtx } from '@/server/authz'
import { lockXact, LOCK_NS } from '@/server/lib/advisory-locks'
import { jobFormSchema } from '@/server/services/jobs'
import { confirmBankOrder } from '@/server/services/billing'
import { clearSettingsCache } from '@/server/services/settings'
import { resolveCompanyEntitlements } from '@/server/services/subscription-entitlements'
import { testDb } from '../setup/db'
import { createEmployer, createEmployerWithoutCompany, createStudent } from '../factories'
import { billingFixture, awaitingOrder, setting, type BillingFixture } from './billing-t02'

export const DAY = 86_400_000
export type Limits = { jobPostLimit: number | null; seatLimit: number | null; invitationQuota: number | null }
export const FREE_LIMITS: Limits = { jobPostLimit: 2, seatLimit: 3, invitationQuota: 20 }
export const PAID_LIMITS: Limits = { jobPostLimit: 5, seatLimit: 6, invitationQuota: 200 }

export async function configureBase(billing = true, limits: Limits = FREE_LIMITS) {
  clearSettingsCache()
  await setting('billing.enabled', billing)
  await setting('team.maxMembers', 8)
  await setting('team.maxInvitesPerDay', 100)
  await setting('invitations.freeMonthlyQuota', 17)
  await setting('invitations.expireDays', 14)
  await setting('talentPool.minCompleteness', 60)
  await setting('jobs.autoPublishAfter', 0)
  return testDb.plan.upsert({
    where: { code: 'FREE' },
    create: { code: 'FREE', kind: 'PLAN', nameZh: '合成免费套餐', nameEn: 'Synthetic free plan', priceSen: 0, credits: 0, durationDays: null, ...limits },
    update: { ...limits, isActive: true },
  })
}

export async function verifiedCompany(): Promise<CompanyCtx> {
  const employer = await createEmployer(testDb)
  await testDb.company.update({ where: { id: employer.companyId }, data: { verificationStatus: 'VERIFIED' } })
  return { ...employer, role: 'OWNER' }
}

export async function paySegment(f: BillingFixture) {
  const order = await awaitingOrder(f)
  await confirmBankOrder(f.adminCtx, { orderId: order.id, receivedAmountSen: order.amountSen, note: 'Synthetic T04 receipt' })
  return testDb.subscription.findUniqueOrThrow({ where: { orderId: order.id } })
}

export async function paidCompany(limits: Limits = PAID_LIMITS, durationDays = 365) {
  const f = await billingFixture()
  await testDb.company.update({ where: { id: f.ctx.companyId }, data: { verificationStatus: 'VERIFIED' } })
  await testDb.plan.update({ where: { id: f.plan.id }, data: { ...limits, durationDays } })
  const subscription = await paySegment(f)
  return { ...f, subscription }
}

export async function moveSegment(subscription: Subscription, endsAt: Date) {
  const duration = subscription.endsAt.getTime() - subscription.startsAt.getTime()
  return testDb.subscription.update({ where: { id: subscription.id }, data: { startsAt: new Date(endsAt.getTime() - duration), endsAt } })
}

export function entitlements(companyId: string, now = new Date()) {
  return testDb.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.CREDIT, companyId)
    return resolveCompanyEntitlements(tx, { companyId, now })
  })
}

export function jobInput(overrides: Partial<ReturnType<typeof jobFormSchema.parse>> = {}) {
  return jobFormSchema.parse({ title: 'Synthetic T04 role', description: 'Synthetic role description', type: 'INTERNSHIP', submit: true, ...overrides })
}

export async function seedJob(ctx: { companyId: string; userId: string }, status: Job['status'] = 'PUBLISHED', deadline: Date | null = null) {
  const { submit: _submit, ...fields } = jobInput()
  return testDb.job.create({ data: { ...fields, companyId: ctx.companyId, createdById: ctx.userId, status, deadline, publishedAt: status === 'PUBLISHED' ? new Date() : null } })
}

export async function addMember(companyId: string, role: 'ADMIN' | 'RECRUITER' = 'RECRUITER') {
  const user = await createEmployerWithoutCompany(testDb)
  const member = await testDb.companyMember.create({ data: { companyId, userId: user.userId, role } })
  return { ...user, member }
}

export async function oldInvite(ctx: { companyId: string; userId: string }, role: 'ADMIN' | 'RECRUITER' | 'OWNER' = 'RECRUITER') {
  const user = await createEmployerWithoutCompany(testDb)
  const token = randomUUID()
  const invite = await testDb.companyInvite.create({ data: {
    companyId: ctx.companyId, createdById: ctx.userId, email: user.email, role,
    tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + DAY),
  } })
  return { ...user, token, invite }
}

export async function visibleStudent() {
  const student = await createStudent(testDb, { completeness: 80 })
  await testDb.studentProfile.update({ where: { id: student.profileId }, data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() } })
  return student
}

export async function countOpenJobs(companyId: string) {
  return testDb.job.count({ where: { companyId, status: 'PUBLISHED', OR: [{ deadline: null }, { deadline: { gt: new Date() } }] } })
}

// Real lock contention; no sleep-only inference and no mocked lock/count functions.
export async function whileCreditHeld<T>(companyId: string, operation: () => Promise<T>, afterWaiting: () => Promise<void>) {
  let release!: () => void
  let ready!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const acquired = new Promise<void>((resolve) => { ready = resolve })
  const holder = testDb.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.CREDIT, companyId)
    ready()
    await held
  }, { timeout: 15000 })
  await Promise.race([acquired, holder.then(() => { throw new Error('Lock holder exited before acquisition') })])
  let result: Promise<PromiseSettledResult<T>> | undefined
  try {
    result = operation().then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }))
    await expect.poll(async () => {
      const [row] = await testDb.$queryRaw<Array<{ waiting: number }>>(Prisma.sql`
        SELECT count(*)::int AS waiting FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid = ${LOCK_NS.CREDIT}::oid AND objid = hashtext(${companyId})::oid
      `)
      return row.waiting
    }, { timeout: 3000, interval: 20 }).toBeGreaterThan(0)
    await afterWaiting()
  } finally {
    release()
    const [closed] = await Promise.allSettled([holder, ...(result ? [result] : [])])
    if (closed.status === 'rejected') throw closed.reason
  }
  return result!
}
