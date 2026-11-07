/**
 * Integration tests for reconcile-wallets job (M4-T10).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('@/server/lib/alert', () => ({
  alert: vi.fn(),
}))

import { LedgerReason } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { runReconcileWallets } from '@/server/jobs/reconcile-wallets'
import { applyLedgerEntry } from '@/server/services/credits'
import { alert } from '@/server/lib/alert'

setupTestDb()

beforeEach(() => {
  vi.mocked(alert).mockClear()
})

describe('runReconcileWallets', () => {
  it('no alert when all wallets are balanced', async () => {
    const { companyId } = await createEmployer(testDb)
    await testDb.creditWallet.create({ data: { companyId, balance: 0 } })
    // No ledger entries: SUM(delta)=0 == balance=0 → balanced

    await runReconcileWallets()

    expect(vi.mocked(alert)).not.toHaveBeenCalled()
  })

  it('no alert when wallet has matching ledger sum', async () => {
    const { companyId } = await createEmployer(testDb)
    await testDb.creditWallet.create({ data: { companyId, balance: 0 } })

    await testDb.$transaction(async tx => {
      await applyLedgerEntry(tx, {
        companyId,
        delta: 30,
        reason: LedgerReason.PILOT_GRANT,
      })
    })
    await testDb.$transaction(async tx => {
      await applyLedgerEntry(tx, {
        companyId,
        delta: -5,
        reason: LedgerReason.UNLOCK,
      })
    })
    // balance=25, SUM(delta)=25 → balanced

    await runReconcileWallets()

    expect(vi.mocked(alert)).not.toHaveBeenCalled()
  })

  it('alerts wallet.mismatch when balance does not match ledger sum', async () => {
    const { companyId } = await createEmployer(testDb)
    const wallet = await testDb.creditWallet.create({ data: { companyId, balance: 100 } })
    // Inject a ledger entry with sum 50, but wallet shows 100
    await testDb.creditLedger.create({
      data: {
        walletId: wallet.id,
        delta: 50,
        balanceAfter: 50,
        reason: LedgerReason.PILOT_GRANT,
      },
    })

    await runReconcileWallets()

    expect(vi.mocked(alert)).toHaveBeenCalledWith('wallet.mismatch', {
      companyId,
      expected: 50,
      actual: 100,
    })
  })

  it('alerts for each mismatched wallet independently', async () => {
    // Company A: balanced
    const { companyId: companyA } = await createEmployer(testDb)
    await testDb.creditWallet.create({ data: { companyId: companyA, balance: 0 } })

    // Company B: mismatch (balance 10, ledger sum 20)
    const { companyId: companyB } = await createEmployer(testDb)
    const walletB = await testDb.creditWallet.create({ data: { companyId: companyB, balance: 10 } })
    await testDb.creditLedger.create({
      data: {
        walletId: walletB.id,
        delta: 20,
        balanceAfter: 20,
        reason: LedgerReason.PILOT_GRANT,
      },
    })

    // Company C: mismatch (balance 5, ledger sum 15)
    const { companyId: companyC } = await createEmployer(testDb)
    const walletC = await testDb.creditWallet.create({ data: { companyId: companyC, balance: 5 } })
    await testDb.creditLedger.create({
      data: {
        walletId: walletC.id,
        delta: 15,
        balanceAfter: 15,
        reason: LedgerReason.PILOT_GRANT,
      },
    })

    await runReconcileWallets()

    expect(vi.mocked(alert)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(alert)).toHaveBeenCalledWith('wallet.mismatch', {
      companyId: companyB,
      expected: 20,
      actual: 10,
    })
    expect(vi.mocked(alert)).toHaveBeenCalledWith('wallet.mismatch', {
      companyId: companyC,
      expected: 15,
      actual: 5,
    })
  })

  it('returns 0 mismatches after a concurrent unlock test scenario', async () => {
    // Create a company and run credits through the proper service (always consistent)
    const { companyId } = await createEmployer(testDb)
    await testDb.creditWallet.create({ data: { companyId, balance: 0 } })

    await testDb.$transaction(async tx => {
      await applyLedgerEntry(tx, { companyId, delta: 30, reason: LedgerReason.PILOT_GRANT })
    })
    await testDb.$transaction(async tx => {
      await applyLedgerEntry(tx, { companyId, delta: -1, reason: LedgerReason.UNLOCK })
    })
    await testDb.$transaction(async tx => {
      await applyLedgerEntry(tx, { companyId, delta: -1, reason: LedgerReason.UNLOCK })
    })

    await runReconcileWallets()

    expect(vi.mocked(alert)).not.toHaveBeenCalled()
  })
})
