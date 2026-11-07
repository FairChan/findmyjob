/**
 * Integration tests for pilot-monthly-credits job (M4-T10).
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

// alert is a no-op in tests
vi.mock('@/server/lib/alert', () => ({
  alert: vi.fn(),
}))

import { LedgerReason } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { clearSettingsCache } from '@/server/services/settings'
import { runPilotMonthlyCredits, grantPilotCreditsOnVerification } from '@/server/jobs/pilot-monthly-credits'

setupTestDb()

beforeEach(() => {
  clearSettingsCache()
})

async function makeVerifiedCompany() {
  const result = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: result.companyId },
    data: { verificationStatus: 'VERIFIED' },
  })
  await testDb.creditWallet.create({ data: { companyId: result.companyId, balance: 0 } })
  return result
}

describe('runPilotMonthlyCredits', () => {
  it('tops up verified companies to pilot.monthlyCredits (default 30) when billing disabled', async () => {
    const { companyId } = await makeVerifiedCompany()

    await runPilotMonthlyCredits()

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(wallet?.balance).toBe(30)

    const ledger = await testDb.creditLedger.findMany({ where: { wallet: { companyId } } })
    expect(ledger).toHaveLength(1)
    expect(ledger[0].reason).toBe(LedgerReason.PILOT_GRANT)
    expect(ledger[0].delta).toBe(30)
  })

  it('skips when billing.enabled=true', async () => {
    // Seed the billing.enabled setting to true
    await testDb.systemSetting.create({ data: { key: 'billing.enabled', value: true } })
    clearSettingsCache()

    const { companyId } = await makeVerifiedCompany()

    await runPilotMonthlyCredits()

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(wallet?.balance).toBe(0) // no grant
  })

  it('does not double-grant within the same month (idempotency)', async () => {
    const { companyId } = await makeVerifiedCompany()

    await runPilotMonthlyCredits()
    await runPilotMonthlyCredits() // second run in same month

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(wallet?.balance).toBe(30) // granted only once

    const ledger = await testDb.creditLedger.findMany({ where: { wallet: { companyId } } })
    expect(ledger).toHaveLength(1)
  })

  it('does not reduce balance when already at or above monthlyCredits', async () => {
    const { companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    // Create wallet with balance already at 50 (above default 30)
    const wallet = await testDb.creditWallet.create({ data: { companyId, balance: 50 } })
    // Seed a matching ledger entry so reconcile would pass
    await testDb.creditLedger.create({
      data: {
        walletId: wallet.id,
        delta: 50,
        balanceAfter: 50,
        reason: LedgerReason.ADMIN_ADJUST,
      },
    })

    await runPilotMonthlyCredits()

    const updated = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(updated?.balance).toBe(50) // unchanged

    const ledger = await testDb.creditLedger.findMany({ where: { wallet: { companyId } } })
    expect(ledger).toHaveLength(1) // no new entry
  })

  it('tops up to custom pilot.monthlyCredits setting', async () => {
    await testDb.systemSetting.create({ data: { key: 'pilot.monthlyCredits', value: 10 } })
    clearSettingsCache()

    const { companyId } = await makeVerifiedCompany()

    await runPilotMonthlyCredits()

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(wallet?.balance).toBe(10)
  })

  it('top-up amount is the gap between balance and monthlyCredits', async () => {
    const { companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    // Create wallet with balance 10, monthly credits = 30, so gap = 20
    const wallet = await testDb.creditWallet.create({ data: { companyId, balance: 10 } })
    await testDb.creditLedger.create({
      data: {
        walletId: wallet.id,
        delta: 10,
        balanceAfter: 10,
        reason: LedgerReason.ADMIN_ADJUST,
      },
    })

    await runPilotMonthlyCredits()

    const updated = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(updated?.balance).toBe(30)

    const ledger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId }, reason: LedgerReason.PILOT_GRANT },
    })
    expect(ledger).toHaveLength(1)
    expect(ledger[0].delta).toBe(20) // topped up by 20
  })

  it('skips companies without wallets', async () => {
    const { companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    // No wallet created intentionally

    await runPilotMonthlyCredits()

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(wallet).toBeNull() // still no wallet
  })
})

describe('grantPilotCreditsOnVerification', () => {
  it('grants credits immediately when billing disabled', async () => {
    const { companyId } = await makeVerifiedCompany()

    await grantPilotCreditsOnVerification(companyId)

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(wallet?.balance).toBe(30)
  })

  it('skips when billing.enabled=true', async () => {
    await testDb.systemSetting.create({ data: { key: 'billing.enabled', value: true } })
    clearSettingsCache()

    const { companyId } = await makeVerifiedCompany()

    await grantPilotCreditsOnVerification(companyId)

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(wallet?.balance).toBe(0) // no grant
  })

  it('is idempotent: second call in same month skips', async () => {
    const { companyId } = await makeVerifiedCompany()

    await grantPilotCreditsOnVerification(companyId)
    await grantPilotCreditsOnVerification(companyId)

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(wallet?.balance).toBe(30)

    const ledger = await testDb.creditLedger.findMany({ where: { wallet: { companyId } } })
    expect(ledger).toHaveLength(1)
  })
})
