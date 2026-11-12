import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

// Keep the simulated audit failure isolated from the ordinary credits tests.
vi.mock('@/server/services/audit', () => ({
  logAudit: vi.fn().mockRejectedValue(new Error('synthetic audit write failure')),
}))

import { LedgerReason } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer } from '../factories'
import { adminAdjust, applyLedgerEntry } from '@/server/services/credits'

setupTestDb()

describe('adminAdjust audit failure', () => {
  it.each([5, -5])('rolls back a delta of %i when its audit write fails', async (delta) => {
    const { companyId } = await createEmployer(testDb)
    const { userId } = await createAdmin(testDb)
    const wallet = await testDb.creditWallet.create({ data: { companyId, balance: 0 } })
    await testDb.$transaction((tx) => applyLedgerEntry(tx, {
      companyId, delta: 10, reason: LedgerReason.PILOT_GRANT,
    }))

    await expect(adminAdjust({ actorId: userId }, { companyId, delta, note: 'synthetic correction' }))
      .rejects.toThrow('synthetic audit write failure')

    expect(await testDb.creditWallet.findUnique({ where: { id: wallet.id } })).toMatchObject({ balance: 10 })
    const ledger = await testDb.creditLedger.findMany({ where: { walletId: wallet.id } })
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ delta: 10, balanceAfter: 10, reason: LedgerReason.PILOT_GRANT })
    expect(await testDb.auditLog.count({ where: { action: 'credits.adjust', targetId: companyId } })).toBe(0)
  })
})
