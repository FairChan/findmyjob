/** M4-T17: pilot numeric settings and Kuala Lumpur monthly boundaries. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/server/lib/alert', () => ({ alert: vi.fn() }))
vi.mock('@/server/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/server/services/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/server/services/notify', () => ({
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
}))

import { LedgerReason, type Prisma } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { clearSettingsCache } from '@/server/services/settings'
import { applyLedgerEntry } from '@/server/services/credits'
import { runPilotMonthlyCredits } from '@/server/jobs/pilot-monthly-credits'
import { grantPilotCreditsOnVerification } from '@/server/services/pilot-credits'
import { logger } from '@/server/lib/logger'

setupTestDb()

beforeEach(() => {
  clearSettingsCache()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
  clearSettingsCache()
})

async function makeVerifiedCompany() {
  const { companyId } = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: companyId },
    data: { verificationStatus: 'VERIFIED' },
  })
  await testDb.creditWallet.create({ data: { companyId, balance: 0 } })
  return companyId
}

async function seedMonthlyCredits(value: Prisma.InputJsonValue) {
  await testDb.systemSetting.create({ data: { key: 'pilot.monthlyCredits', value } })
  clearSettingsCache()
}

describe.each(['scheduled', 'verification'] as const)('pilot credits: %s entry point', (entryPoint) => {
  it.each([-1, 1.5, 'private-invalid-setting', true, Number.MAX_SAFE_INTEGER + 1])(
    'uses the default 30 for invalid monthly setting %j and logs only the key and default',
    async (value) => {
      await seedMonthlyCredits(value)
      const companyId = await makeVerifiedCompany()

      if (entryPoint === 'scheduled') await runPilotMonthlyCredits()
      else await grantPilotCreditsOnVerification(companyId)

      expect(await testDb.creditWallet.findUnique({ where: { companyId } }))
        .toMatchObject({ balance: 30 })
      const ledger = await testDb.creditLedger.findMany({
        where: { wallet: { companyId }, reason: LedgerReason.PILOT_GRANT },
      })
      expect(ledger).toHaveLength(1)
      expect(ledger[0]).toMatchObject({ delta: 30, refType: 'PilotPeriod' })
      expect(vi.mocked(logger.warn).mock.calls).toEqual([
        [{ key: 'pilot.monthlyCredits', defaultValue: 30 }, expect.any(String)],
      ])
    },
  )
})

it('accepts zero monthly credits and records only one zero marker across both entry points', async () => {
  await seedMonthlyCredits(0)
  const companyId = await makeVerifiedCompany()

  await runPilotMonthlyCredits()
  await grantPilotCreditsOnVerification(companyId)
  await runPilotMonthlyCredits()

  expect(await testDb.creditWallet.findUnique({ where: { companyId } }))
    .toMatchObject({ balance: 0 })
  const ledger = await testDb.creditLedger.findMany({
    where: { wallet: { companyId }, reason: LedgerReason.PILOT_GRANT },
  })
  expect(ledger).toHaveLength(1)
  expect(ledger[0]).toMatchObject({ delta: 0, refType: 'PilotPeriod' })
  expect(logger.warn).not.toHaveBeenCalled()
})

it('uses the new KL month at UTC 16:00 and tops up only the gap once', async () => {
  const companyId = await makeVerifiedCompany()
  // Keep native I/O timers so Prisma transactions remain real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-31T15:59:59.000Z'))

  await grantPilotCreditsOnVerification(companyId)
  await testDb.$transaction(async (tx) => {
    await applyLedgerEntry(tx, {
      companyId,
      delta: -5,
      reason: LedgerReason.UNLOCK,
      refType: 'TalentUnlock',
      refId: 'month-boundary-spend',
    })
  })
  await runPilotMonthlyCredits()
  expect(await testDb.creditWallet.findUnique({ where: { companyId } }))
    .toMatchObject({ balance: 25 })

  vi.setSystemTime(new Date('2026-01-31T16:00:00.000Z'))
  await runPilotMonthlyCredits()
  await grantPilotCreditsOnVerification(companyId)

  expect(await testDb.creditWallet.findUnique({ where: { companyId } }))
    .toMatchObject({ balance: 30 })
  const ledger = await testDb.creditLedger.findMany({
    where: { wallet: { companyId }, reason: LedgerReason.PILOT_GRANT },
    orderBy: { refId: 'asc' },
    select: { refType: true, refId: true, delta: true },
  })
  expect(ledger).toEqual([
    { refType: 'PilotPeriod', refId: '2026-01', delta: 30 },
    { refType: 'PilotPeriod', refId: '2026-02', delta: 5 },
  ])
})
