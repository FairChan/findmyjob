/** Real counts and current authority; usage is a display snapshot, not a growth authorization. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
const io = vi.hoisted(() => ({ getObjectBytes: vi.fn(), notifyOrderConfirmed: vi.fn() }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: io.getObjectBytes }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: io.notifyOrderConfirmed }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { setting, PROOF_BYTES } from '../helpers/billing-t02'
import { configureBase, verifiedCompany, paidCompany, FREE_LIMITS } from '../helpers/subscriptions-t04'
import { getCompanyEntitlementUsage } from '@/server/services/subscription-entitlements'

setupTestDb()
const NOW = new Date('2030-05-12T04:00:00.000Z')
const MONTH_START = new Date('2030-04-30T16:00:00.000Z')
const MONTH_END = new Date('2030-05-31T16:00:00.000Z')
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  io.getObjectBytes.mockReset().mockResolvedValue(PROOF_BYTES)
  io.notifyOrderConfirmed.mockReset().mockResolvedValue(undefined)
  await configureBase()
})
afterEach(() => vi.useRealTimers())

describe('M8-T04 company usage authority and public DTO', () => {
  it.each(['OWNER', 'ADMIN', 'RECRUITER'] as const)('reads for current %s and derives purchase ability from the persisted role', async role => {
    const ctx = await verifiedCompany()
    await testDb.companyMember.update({ where: { userId: ctx.userId }, data: { role } })
    const staleCtx = { ...ctx, role: role === 'OWNER' ? 'RECRUITER' as const : 'OWNER' as const }
    expect(await getCompanyEntitlementUsage(staleCtx)).toEqual({
      source: 'FREE', effectiveUntil: null,
      jobs: { used: 0, limit: FREE_LIMITS.jobPostLimit },
      seats: { used: 1, reserved: 0, limit: FREE_LIMITS.seatLimit },
      invitations: { used: 0, limit: FREE_LIMITS.invitationQuota },
      canPurchase: role === 'OWNER',
    })
  })

  it.each(['removed-member', 'suspended-user', 'wrong-user-role', 'inactive-company', 'foreign-company'] as const)(
    'rejects %s even when the supplied context still claims OWNER',
    async fault => {
      const ctx = await verifiedCompany()
      await expect(getCompanyEntitlementUsage(ctx)).resolves.toMatchObject({ canPurchase: true })
      if (fault === 'removed-member') await testDb.companyMember.delete({ where: { userId: ctx.userId } })
      if (fault === 'suspended-user') await testDb.user.update({ where: { id: ctx.userId }, data: { status: 'SUSPENDED' } })
      if (fault === 'wrong-user-role') await testDb.user.update({ where: { id: ctx.userId }, data: { role: 'STUDENT' } })
      if (fault === 'inactive-company') await testDb.company.update({ where: { id: ctx.companyId }, data: { isActive: false } })
      const input = fault === 'foreign-company' ? { ...ctx, companyId: (await verifiedCompany()).companyId } : ctx
      await expect(getCompanyEntitlementUsage(input)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    },
  )

  it('reflects demotion and promotion on each read without trusting an old role or cached sales flag', async () => {
    const ctx = await verifiedCompany()
    expect((await getCompanyEntitlementUsage(ctx)).canPurchase).toBe(true)
    await testDb.companyMember.update({ where: { userId: ctx.userId }, data: { role: 'RECRUITER' } })
    expect((await getCompanyEntitlementUsage(ctx)).canPurchase).toBe(false)
    await testDb.companyMember.update({ where: { userId: ctx.userId }, data: { role: 'OWNER' } })
    expect((await getCompanyEntitlementUsage({ ...ctx, role: 'RECRUITER' })).canPurchase).toBe(true)
    await setting('billing.enabled', false)
    expect(await getCompanyEntitlementUsage(ctx)).toMatchObject({ source: 'PILOT', canPurchase: false })
  })

  it('reports every over-limit row beyond 100 and applies exact slot, reservation and KL-month predicates', async () => {
    const ctx = await verifiedCompany()
    await testDb.job.createMany({ data: Array.from({ length: 105 }, (_, index) => ({
      companyId: ctx.companyId, createdById: ctx.userId, title: 'Synthetic count job ' + index,
      type: 'INTERNSHIP' as const, description: 'Synthetic description', status: 'PUBLISHED' as const,
      languages: [], skills: [], deadline: null,
    })) })
    await testDb.job.createMany({ data: [
      { status: 'PUBLISHED' as const, deadline: NOW },
      { status: 'DRAFT' as const, deadline: null },
      { status: 'PENDING_REVIEW' as const, deadline: null },
      { status: 'CLOSED' as const, deadline: null },
    ].map((job, index) => ({
      ...job, companyId: ctx.companyId, createdById: ctx.userId, title: 'Synthetic excluded job ' + index,
      type: 'INTERNSHIP' as const, description: 'Synthetic description', languages: [], skills: [],
    })) })
    const memberIds = Array.from({ length: 105 }, (_, index) => 't04-usage-member-' + index)
    await testDb.user.createMany({ data: memberIds.map(id => ({
      id, name: 'Synthetic usage member', email: id + '@example.test', role: 'EMPLOYER' as const, status: 'ACTIVE' as const,
    })) })
    await testDb.companyMember.createMany({ data: memberIds.map(userId => ({
      companyId: ctx.companyId, userId, role: 'RECRUITER' as const,
    })) })
    await testDb.companyInvite.createMany({ data: Array.from({ length: 105 }, (_, index) => ({
      companyId: ctx.companyId, createdById: ctx.userId, role: index % 2 ? 'ADMIN' as const : 'RECRUITER' as const,
      email: 'reserved-' + index + '@example.test', tokenHash: 'synthetic-reserved-' + index,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    })) })
    await testDb.companyInvite.createMany({ data: [
      { role: 'OWNER' as const, acceptedAt: null, expiresAt: new Date(NOW.getTime() + 86_400_000) },
      { role: 'RECRUITER' as const, acceptedAt: NOW, expiresAt: new Date(NOW.getTime() + 86_400_000) },
      { role: 'ADMIN' as const, acceptedAt: null, expiresAt: NOW },
    ].map((invite, index) => ({
      ...invite, companyId: ctx.companyId, createdById: ctx.userId,
      email: 'excluded-' + index + '@example.test', tokenHash: 'synthetic-excluded-' + index,
    })) })
    const student = await createStudent(testDb)
    await testDb.invitation.createMany({ data: Array.from({ length: 105 }, (_, index) => ({
      companyId: ctx.companyId, studentId: student.profileId, sentById: ctx.userId,
      status: (['SENT', 'DECLINED', 'ACCEPTED', 'EXPIRED'] as const)[index % 4],
      createdAt: index === 0 ? MONTH_START : NOW, expiresAt: MONTH_END,
    })) })
    await testDb.invitation.createMany({ data: [
      new Date(MONTH_START.getTime() - 1), MONTH_END,
    ].map(createdAt => ({
      companyId: ctx.companyId, studentId: student.profileId, sentById: ctx.userId,
      status: 'EXPIRED' as const, createdAt, expiresAt: new Date(MONTH_END.getTime() + 86_400_000),
    })) })
    const other = await verifiedCompany()
    await testDb.job.create({ data: {
      companyId: other.companyId, createdById: other.userId, title: 'Synthetic foreign job',
      type: 'INTERNSHIP', description: 'Synthetic foreign description', status: 'PUBLISHED',
      languages: [], skills: [],
    } })
    const dto = await getCompanyEntitlementUsage(ctx)
    expect(dto).toEqual({
      source: 'FREE', effectiveUntil: null,
      jobs: { used: 105, limit: 2 }, seats: { used: 106, reserved: 105, limit: 3 },
      invitations: { used: 105, limit: 20 }, canPurchase: true,
    })
    expect(await testDb.job.count({ where: { companyId: ctx.companyId } })).toBe(109)
    expect(await testDb.companyMember.count({ where: { companyId: ctx.companyId } })).toBe(106)
  })

  it('whitelists the paid usage DTO, preserves explicit unlimited and disables only purchasing when sales close', async () => {
    const f = await paidCompany({ jobPostLimit: null, seatLimit: null, invitationQuota: null })
    const order = await testDb.order.findUniqueOrThrow({ where: { id: f.subscription.orderId! } })
    const privateValue = 'SYNTHETIC_PRIVATE_USAGE_FIELD'
    await testDb.order.update({
      where: { id: order.id },
      data: { commercialSnapshot: {
        ...(order.commercialSnapshot as Prisma.JsonObject),
        privateExtra: privateValue, paymentBinding: { key: privateValue },
      } },
    })
    const expected = {
      source: 'SUBSCRIPTION', effectiveUntil: f.subscription.endsAt.toISOString(),
      jobs: { used: 0, limit: null }, seats: { used: 1, reserved: 0, limit: null },
      invitations: { used: 0, limit: null }, canPurchase: true,
    }
    const dto = await getCompanyEntitlementUsage(f.ctx)
    expect(dto).toEqual(expected)
    for (const privateField of [
      f.subscription.id, order.id, f.plan.id, privateValue, 'fallbackReason', 'commercialSnapshot', 'orderId', 'planId',
    ]) expect(JSON.stringify(dto)).not.toContain(privateField)
    await setting('billing.enabled', false)
    expect(await getCompanyEntitlementUsage(f.ctx)).toEqual({ ...expected, canPurchase: false })
  })
})
