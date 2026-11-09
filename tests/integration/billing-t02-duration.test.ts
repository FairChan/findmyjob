/**
 * M8-T02 duration regression proposal; report-only until mainline applies it.
 * Real guarded DB and billing services. Only storage/notification are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getObjectBytes: vi.fn(), notifyOrderConfirmed: vi.fn() }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: mocks.getObjectBytes }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: mocks.notifyOrderConfirmed }))

import { setupTestDb, testDb } from '../setup/db'
import { billingFixture, awaitingOrder, PROOF_BYTES } from '../helpers/billing-t02'
import { quoteOrder, createOrder, confirmBankOrder } from '@/server/services/billing'

setupTestDb()
beforeEach(() => {
  mocks.getObjectBytes.mockReset().mockResolvedValue(PROOF_BYTES)
  mocks.notifyOrderConfirmed.mockReset().mockResolvedValue(undefined)
})

describe('M8-T02 reject unfulfillable subscription duration before payment', () => {
  it('does not quote a positive PostgreSQL Int duration that overflows the subscription end date', async () => {
    const f = await billingFixture()
    await testDb.plan.update({ where: { id: f.plan.id }, data: { durationDays: 2_147_483_647 } })

    await expect(quoteOrder(f.ctx, { planId: f.plan.id })).rejects.toThrow()
    expect(await testDb.order.count({ where: { companyId: f.ctx.companyId } })).toBe(0)
    expect(await testDb.subscription.count({ where: { companyId: f.ctx.companyId } })).toBe(0)
    expect(await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } })).toBeNull()
    expect(await testDb.auditLog.count({ where: { action: 'order.create' } })).toBe(0)
    expect(mocks.notifyOrderConfirmed).not.toHaveBeenCalled()
  })

  it('rechecks the latest paid subscription tail when creating from an otherwise unchanged quote', async () => {
    const f = await billingFixture()
    const first = await awaitingOrder(f)
    await confirmBankOrder(f.adminCtx, {
      orderId: first.id, receivedAmountSen: first.amountSen, note: 'Synthetic initial subscription',
    })
    const existing = await testDb.subscription.findUniqueOrThrow({ where: { orderId: first.id } })
    const day = 86_400_000
    const maxDateMs = 8_640_000_000_000_000
    // This duration fits against the current tail. Only normal calendar dates
    // are stored in PostgreSQL; the near-limit end date remains prospective.
    const durationDays = Math.floor((maxDateMs - existing.endsAt.getTime()) / day) - 1
    await testDb.plan.update({ where: { id: f.plan.id }, data: { durationDays } })
    const acceptedQuote = await quoteOrder(f.ctx, { planId: f.plan.id })
    expect(Number.isFinite(new Date(existing.endsAt.getTime() + durationDays * day).getTime())).toBe(true)

    // Simulate another paid extension after the user saw the quote. The plan,
    // acceptedQuote, and monetary terms remain unchanged; create must re-read.
    const latestTail = new Date(existing.endsAt.getTime() + 3 * day)
    await testDb.subscription.update({ where: { id: existing.id }, data: { endsAt: latestTail } })
    expect(Number.isFinite(new Date(latestTail.getTime() + durationDays * day).getTime())).toBe(false)
    const paidBefore = await testDb.order.findUniqueOrThrow({ where: { id: first.id } })
    const ledgerBefore = await testDb.creditLedger.findMany({ where: { wallet: { companyId: f.ctx.companyId } } })
    const walletBefore = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId: f.ctx.companyId } })
    const auditsBefore = await testDb.auditLog.count({ where: { action: 'order.create' } })
    mocks.notifyOrderConfirmed.mockClear()

    await expect(createOrder(f.ctx, {
      planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote,
    })).rejects.toThrow()
    expect(await testDb.order.findMany({ where: { companyId: f.ctx.companyId } })).toEqual([paidBefore])
    expect(await testDb.order.count({
      where: { companyId: f.ctx.companyId, status: { in: ['PENDING', 'AWAITING_CONFIRMATION'] } },
    })).toBe(0)
    expect(await testDb.subscription.findMany({ where: { companyId: f.ctx.companyId } }))
      .toEqual([{ ...existing, endsAt: latestTail }])
    expect(await testDb.creditLedger.findMany({ where: { wallet: { companyId: f.ctx.companyId } } })).toEqual(ledgerBefore)
    expect(await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } })).toEqual(walletBefore)
    expect(await testDb.auditLog.count({ where: { action: 'order.create' } })).toBe(auditsBefore)
    expect(mocks.notifyOrderConfirmed).not.toHaveBeenCalled()
  })
})
