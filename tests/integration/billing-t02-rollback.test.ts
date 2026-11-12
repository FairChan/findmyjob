import { beforeEach, describe, expect, it, vi } from 'vitest'

const faults = vi.hoisted(() => ({
  audit: false, subscription: false,
  getObjectBytes: vi.fn(), notifyOrderConfirmed: vi.fn(),
}))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  // Real DB transaction; inject failure only at the actual subscription insert.
  const db = testDb.$extends({
    query: {
      subscription: {
        async create({ args, query }) {
          if (faults.subscription) throw new Error('synthetic subscription write failure')
          return query(args)
        },
      },
    },
  })
  return { db }
})
vi.mock('@/server/services/audit', async () => {
  const actual = await vi.importActual<typeof import('@/server/services/audit')>('@/server/services/audit')
  return {
    ...actual,
    logAudit: async (...args: Parameters<typeof actual.logAudit>) => {
      if (faults.audit && args[0].action === 'order.confirm') throw new Error('synthetic order audit failure')
      return actual.logAudit(...args)
    },
  }
})
vi.mock('@/lib/storage', () => ({ getObjectBytes: faults.getObjectBytes }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: faults.notifyOrderConfirmed }))

import { setupTestDb, testDb } from '../setup/db'
import { billingFixture, awaitingOrder, PROOF_BYTES } from '../helpers/billing-t02'
import { confirmBankOrder } from '@/server/services/billing'
import { createWallet, applyLedgerEntry } from '@/server/services/credits'

setupTestDb()
beforeEach(() => {
  faults.audit = false
  faults.subscription = false
  faults.getObjectBytes.mockReset().mockResolvedValue(PROOF_BYTES)
  faults.notifyOrderConfirmed.mockReset().mockResolvedValue(undefined)
})

describe('M8-T02 settlement atomicity', () => {
  it.each([
    { kind: 'PLAN' as const, fault: 'audit' as const, message: 'synthetic order audit failure' },
    { kind: 'PLAN' as const, fault: 'subscription' as const, message: 'synthetic subscription write failure' },
    { kind: 'CREDIT_PACK' as const, fault: 'audit' as const, message: 'synthetic order audit failure' },
  ])('rolls back all $kind delivery on $fault failure and can retry once', async ({ kind, fault, message }) => {
    const f = await billingFixture(kind)
    if (kind === 'CREDIT_PACK') {
      await testDb.$transaction(async (tx) => {
        await createWallet(tx, f.ctx.companyId)
        await applyLedgerEntry(tx, { companyId: f.ctx.companyId, delta: 7, reason: 'PILOT_GRANT' })
      })
    }
    const order = await awaitingOrder(f)
    const walletBefore = await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } })
    const ledgerBefore = await testDb.creditLedger.findMany({ where: { wallet: { companyId: f.ctx.companyId } } })
    const auditBefore = await testDb.auditLog.findMany({ where: { targetType: 'Order', targetId: order.id }, orderBy: { id: 'asc' } })
    faults[fault] = true
    const input = { orderId: order.id, receivedAmountSen: order.amountSen, note: 'Synthetic reconciliation' }
    try {
      await expect(confirmBankOrder(f.adminCtx, input)).rejects.toThrow(message)
      expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(order)
      expect(await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } })).toEqual(walletBefore)
      expect(await testDb.creditLedger.findMany({ where: { wallet: { companyId: f.ctx.companyId } } })).toEqual(ledgerBefore)
      expect(await testDb.subscription.count({ where: { orderId: order.id } })).toBe(0)
      expect(await testDb.auditLog.findMany({ where: { targetType: 'Order', targetId: order.id }, orderBy: { id: 'asc' } })).toEqual(auditBefore)
      expect(faults.notifyOrderConfirmed).not.toHaveBeenCalled()
    } finally {
      faults[fault] = false
    }
    await expect(confirmBankOrder(f.adminCtx, input)).resolves.toMatchObject({ alreadyPaid: false })
    await expect(confirmBankOrder(f.adminCtx, input)).resolves.toMatchObject({ alreadyPaid: true })
    expect(await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } }))
      .toMatchObject({ balance: (walletBefore?.balance ?? 0) + f.plan.credits })
    expect(await testDb.creditLedger.count({ where: { refType: 'Order', refId: order.id } })).toBe(1)
    expect(await testDb.subscription.count({ where: { orderId: order.id } })).toBe(kind === 'PLAN' ? 1 : 0)
    expect(await testDb.auditLog.count({ where: { action: 'order.confirm', targetId: order.id } })).toBe(1)
    expect(faults.notifyOrderConfirmed).toHaveBeenCalledOnce()
  })
})
