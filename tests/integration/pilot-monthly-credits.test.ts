/**
 * Integration tests for pilot-monthly-credits job (M4-T10, M4-T20).
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
import { clearSettingsCache } from '@/server/services/settings'
import { runPilotMonthlyCredits, grantPilotCreditsOnVerification } from '@/server/jobs/pilot-monthly-credits'
import { applyLedgerEntry } from '@/server/services/credits'
import { alert } from '@/server/lib/alert'

setupTestDb()

beforeEach(() => {
  clearSettingsCache()
  vi.mocked(alert).mockClear()
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

    // A delta=0 PILOT_GRANT row is now written to record "checked this month"
    const pilotLedger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId }, reason: LedgerReason.PILOT_GRANT },
    })
    expect(pilotLedger).toHaveLength(1)
    expect(pilotLedger[0].delta).toBe(0)
    expect(pilotLedger[0].refType).toBe('PilotPeriod')
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

// ---------------------------------------------------------------------------
// M4-T20: re-run idempotency, concurrent dedup, failure isolation
// ---------------------------------------------------------------------------

describe('runPilotMonthlyCredits: M4-T20 same-month re-run', () => {
  it('(a) balance already 30 → task writes delta=0 marker → unlock 10 → re-run → balance 20, no delta>0 PILOT_GRANT', async () => {
    const { companyId } = await makeVerifiedCompany()
    const wallet = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId } })
    // Top up balance to 30 via ADMIN_ADJUST to simulate "already at quota"
    await testDb.$transaction(async tx => {
      await applyLedgerEntry(tx, {
        companyId,
        delta: 30,
        reason: LedgerReason.ADMIN_ADJUST,
      })
    })

    // First run: balance=30, writes delta=0 PILOT_GRANT marker
    await runPilotMonthlyCredits()

    let w = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId } })
    expect(w.balance).toBe(30)
    let pilotRows = await testDb.creditLedger.findMany({
      where: { wallet: { companyId }, reason: LedgerReason.PILOT_GRANT },
    })
    expect(pilotRows).toHaveLength(1)
    expect(pilotRows[0].delta).toBe(0)

    // Simulate spending 10 credits
    await testDb.$transaction(async tx => {
      await applyLedgerEntry(tx, {
        companyId,
        delta: -10,
        reason: LedgerReason.UNLOCK,
        refType: 'TalentUnlock',
        refId: 'fake-unlock-1',
      })
    })

    // Second run: should be skipped (refId already exists for this month)
    await runPilotMonthlyCredits()

    w = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId } })
    expect(w.balance).toBe(20) // no extra grant

    pilotRows = await testDb.creditLedger.findMany({
      where: { wallet: { companyId }, reason: LedgerReason.PILOT_GRANT },
    })
    // Still only 1 PILOT_GRANT row (the delta=0 marker from the first run)
    expect(pilotRows).toHaveLength(1)
    expect(pilotRows.every(r => r.delta === 0)).toBe(true)
    // Verification: removing the wallet balance check on idempotency would cause a 2nd grant row
    void wallet // ensure the variable is used
  })

  it('(b) run → spend 5 → re-run → balance 25, only 1 PILOT_GRANT row', async () => {
    const { companyId } = await makeVerifiedCompany()

    // First run: balance=0 → grant 30
    await runPilotMonthlyCredits()

    let w = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId } })
    expect(w.balance).toBe(30)

    // Spend 5
    await testDb.$transaction(async tx => {
      await applyLedgerEntry(tx, {
        companyId,
        delta: -5,
        reason: LedgerReason.UNLOCK,
        refType: 'TalentUnlock',
        refId: 'fake-unlock-2',
      })
    })

    // Second run: same month, should skip
    await runPilotMonthlyCredits()

    w = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId } })
    expect(w.balance).toBe(25) // no second grant

    const pilotRows = await testDb.creditLedger.findMany({
      where: { wallet: { companyId }, reason: LedgerReason.PILOT_GRANT },
    })
    expect(pilotRows).toHaveLength(1) // only the original grant
    expect(pilotRows[0].delta).toBe(30)
  })

  it('(c) concurrent 3 calls → only 1 grant row, balance 30 (lockXact prevents duplicates)', async () => {
    const { companyId } = await makeVerifiedCompany()

    // All three run concurrently: two runPilotMonthlyCredits + one grantPilotCreditsOnVerification
    await Promise.all([
      runPilotMonthlyCredits(),
      runPilotMonthlyCredits(),
      grantPilotCreditsOnVerification(companyId),
    ])

    const w = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId } })
    expect(w.balance).toBe(30)

    const pilotRows = await testDb.creditLedger.findMany({
      where: { wallet: { companyId }, reason: LedgerReason.PILOT_GRANT },
    })
    expect(pilotRows).toHaveLength(1)
  })
})

describe('runPilotMonthlyCredits: M4-T20 failure isolation', () => {
  it('one company throws → others still get credits, alert called once per failure', async () => {
    const { companyId: goodCompanyId } = await makeVerifiedCompany()
    const { companyId: badCompanyId } = await makeVerifiedCompany()

    const creditsModule = await import('@/server/services/credits')
    const original = creditsModule.grantPilotCredits
    const spy = vi.spyOn(creditsModule, 'grantPilotCredits').mockImplementation(async (id, monthly, start) => {
      if (id === badCompanyId) throw new Error('simulated DB error')
      return original(id, monthly, start)
    })

    try {
      await expect(runPilotMonthlyCredits()).rejects.toThrow('1 company(ies) failed')
    } finally {
      spy.mockRestore()
    }

    const goodWallet = await testDb.creditWallet.findUniqueOrThrow({ where: { companyId: goodCompanyId } })
    expect(goodWallet.balance).toBe(30)

    expect(vi.mocked(alert)).toHaveBeenCalledWith('pilot.grant.failed', { companyId: badCompanyId })
    expect(vi.mocked(alert)).toHaveBeenCalledTimes(1)
  })
})

describe('grantPilotCreditsOnVerification: M4-T20 alert on failure', () => {
  it('calls alert and rethrows when grantPilotCredits throws', async () => {
    const { companyId } = await makeVerifiedCompany()

    const creditsModule = await import('@/server/services/credits')
    const spy = vi.spyOn(creditsModule, 'grantPilotCredits').mockRejectedValueOnce(new Error('forced failure'))

    try {
      await expect(grantPilotCreditsOnVerification(companyId)).rejects.toThrow('forced failure')
    } finally {
      spy.mockRestore()
    }

    expect(vi.mocked(alert)).toHaveBeenCalledWith('pilot.grant.failed', { companyId })
  })
})
