/** Requires T02's reviewed fixture/module and T04's agreed resolver signature. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
const io = vi.hoisted(() => ({ getObjectBytes: vi.fn(), notifyOrderConfirmed: vi.fn() }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: io.getObjectBytes }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: io.notifyOrderConfirmed }))
import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { billingFixture, awaitingOrder, setting, PROOF_BYTES } from '../helpers/billing-t02'
import { configureBase, entitlements, paidCompany, paySegment, DAY, FREE_LIMITS, PAID_LIMITS } from '../helpers/subscriptions-t04'
import { confirmBankOrder } from '@/server/services/billing'
import { getSetting } from '@/server/services/settings'
setupTestDb()
beforeEach(async () => {
  io.getObjectBytes.mockReset().mockResolvedValue(PROOF_BYTES)
  io.notifyOrderConfirmed.mockReset().mockResolvedValue(undefined)
  await configureBase()
})

describe('M8-T04 current entitlement source', () => {
  it('uses current FREE limits without inheriting non-default pilot settings', async () => {
    const ctx = await createEmployer(testDb)
    expect(await entitlements(ctx.companyId)).toMatchObject({ source: 'FREE', ...FREE_LIMITS })
  })

  it('uses pilot settings and no commercial job cap when sales are off and no subscription is active', async () => {
    const ctx = await createEmployer(testDb)
    await setting('billing.enabled', false)
    expect(await entitlements(ctx.companyId)).toMatchObject({ source: 'PILOT', jobPostLimit: null, seatLimit: 8, invitationQuota: 17 })
  })

  it('does not retain cached sales/pilot settings in a fresh transaction', async () => {
    const ctx = await createEmployer(testDb)
    await getSetting('billing.enabled', true)
    await setting('billing.enabled', false)
    await setting('team.maxMembers', 9)
    expect(await entitlements(ctx.companyId)).toMatchObject({ source: 'PILOT', seatLimit: 9 })
    await setting('billing.enabled', true)
    expect(await entitlements(ctx.companyId)).toMatchObject({ source: 'FREE', ...FREE_LIMITS })
  })

  it.each(['missing', 'invalid'] as const)('fails bounded when FREE is %s', async (mode) => {
    const ctx = await createEmployer(testDb)
    if (mode === 'missing') await testDb.plan.delete({ where: { code: 'FREE' } })
    else await testDb.plan.update({ where: { code: 'FREE' }, data: { jobPostLimit: null, seatLimit: 0, invitationQuota: -1 } })
    expect(await entitlements(ctx.companyId)).toMatchObject({ source: 'FREE', ...FREE_LIMITS })
  })

  it.each([false, true])('honours the paid snapshot with billing.enabled=%s after Plan edits', async (enabled) => {
    const f = await paidCompany()
    await testDb.plan.update({ where: { id: f.plan.id }, data: { ...FREE_LIMITS, isActive: false, isPublic: false } })
    await setting('billing.enabled', enabled)
    expect(await entitlements(f.ctx.companyId)).toMatchObject({ source: 'SUBSCRIPTION', subscriptionId: f.subscription.id, ...PAID_LIMITS })
  })

  it('supports explicit unlimited values but does not treat a missing field as unlimited', async () => {
    const f = await paidCompany({ jobPostLimit: null, seatLimit: null, invitationQuota: null })
    expect(await entitlements(f.ctx.companyId)).toMatchObject({ source: 'SUBSCRIPTION', jobPostLimit: null, seatLimit: null, invitationQuota: null })
    const order = await testDb.order.findUniqueOrThrow({ where: { id: f.subscription.orderId! } })
    const snapshot = structuredClone(order.commercialSnapshot) as Record<string, unknown>
    const delivery = snapshot.delivery as Record<string, unknown>
    delete (delivery.subscription as Record<string, unknown>).seatLimit
    await testDb.order.update({ where: { id: order.id }, data: { commercialSnapshot: snapshot as Prisma.InputJsonObject } })
    expect(await entitlements(f.ctx.companyId)).toMatchObject({ source: 'FREE', fallbackReason: 'INVALID_SNAPSHOT', ...FREE_LIMITS })
  })

  it('uses half-open subscription endpoints without waiting for the expiry worker', async () => {
    const f = await paidCompany()
    const { startsAt, endsAt } = f.subscription
    expect(await entitlements(f.ctx.companyId, new Date(startsAt.getTime() - 1))).toMatchObject({ source: 'FREE' })
    expect(await entitlements(f.ctx.companyId, startsAt)).toMatchObject({ source: 'SUBSCRIPTION', ...PAID_LIMITS })
    expect(await entitlements(f.ctx.companyId, new Date(endsAt.getTime() - 1))).toMatchObject({ source: 'SUBSCRIPTION' })
    expect(await entitlements(f.ctx.companyId, endsAt)).toMatchObject({ source: 'FREE', ...FREE_LIMITS })
    expect((await testDb.subscription.findUniqueOrThrow({ where: { id: f.subscription.id } })).status).toBe('ACTIVE')
  })

  it('does not use future renewal terms until their exact start, including when sales are off', async () => {
    const f = await paidCompany()
    const nextLimits = { jobPostLimit: 7, seatLimit: 9, invitationQuota: 300 }
    await testDb.plan.update({ where: { id: f.plan.id }, data: nextLimits })
    const next = await paySegment(f)
    expect(next.startsAt).toEqual(f.subscription.endsAt)
    await setting('billing.enabled', false)
    expect(await entitlements(f.ctx.companyId, new Date(next.startsAt.getTime() - 1))).toMatchObject({ subscriptionId: f.subscription.id, ...PAID_LIMITS })
    expect(await entitlements(f.ctx.companyId, next.startsAt)).toMatchObject({ subscriptionId: next.id, ...nextLimits })
  })

  it.each(['no-order', 'unpaid', 'wrong-company', 'wrong-plan', 'no-snapshot', 'unknown-version'] as const)('rejects %s as a source of paid limits', async (fault) => {
    const f = await paidCompany()
    const orderId = f.subscription.orderId!
    if (fault === 'no-order') await testDb.subscription.update({ where: { id: f.subscription.id }, data: { orderId: null } })
    if (fault === 'unpaid') await testDb.order.update({ where: { id: orderId }, data: { status: 'PENDING' } })
    if (fault === 'wrong-company') {
      const other = await createEmployer(testDb)
      await testDb.order.update({ where: { id: orderId }, data: { companyId: other.companyId } })
    }
    if (fault === 'wrong-plan') {
      const free = await testDb.plan.findUniqueOrThrow({ where: { code: 'FREE' } })
      await testDb.subscription.update({ where: { id: f.subscription.id }, data: { planId: free.id } })
    }
    if (fault === 'no-snapshot') await testDb.order.update({ where: { id: orderId }, data: { commercialSnapshot: Prisma.DbNull } })
    if (fault === 'unknown-version') {
      const order = await testDb.order.findUniqueOrThrow({ where: { id: orderId } })
      const snapshot = structuredClone(order.commercialSnapshot) as Record<string, unknown>
      await testDb.order.update({ where: { id: orderId }, data: { commercialSnapshot: { ...snapshot, version: 999 } as Prisma.InputJsonObject } })
    }
    expect(await entitlements(f.ctx.companyId)).toMatchObject({ source: 'FREE', fallbackReason: 'INVALID_SNAPSHOT', ...FREE_LIMITS })
  })

  it('falls back on overlapping active segments instead of combining their maximum limits', async () => {
    const f = await paidCompany()
    const next = await paySegment(f)
    await testDb.subscription.update({ where: { id: next.id }, data: { startsAt: f.subscription.startsAt, endsAt: f.subscription.endsAt } })
    expect(await entitlements(f.ctx.companyId)).toMatchObject({ source: 'FREE', fallbackReason: 'OVERLAP', ...FREE_LIMITS })
  })

  it('does not derive subscription limits from purchased credit balance', async () => {
    const f = await billingFixture('CREDIT_PACK')
    const order = await awaitingOrder(f)
    await confirmBankOrder(f.adminCtx, { orderId: order.id, receivedAmountSen: order.amountSen, note: 'Synthetic pack receipt' })
    expect(await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } })).toMatchObject({ balance: 10 })
    expect(await entitlements(f.ctx.companyId)).toMatchObject({ source: 'FREE', ...FREE_LIMITS })
  })

  it('returns to configured pilot allowances at expiry while preserving existing records', async () => {
    const f = await paidCompany()
    await setting('billing.enabled', false)
    const before = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId: f.ctx.companyId } })
    expect(await entitlements(f.ctx.companyId, new Date(f.subscription.endsAt.getTime() + DAY))).toMatchObject({ source: 'PILOT', jobPostLimit: null, seatLimit: 8, invitationQuota: 17 })
    expect(await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } })).toEqual(before)
    expect(await testDb.companyMember.count({ where: { companyId: f.ctx.companyId } })).toBe(1)
  })
})
