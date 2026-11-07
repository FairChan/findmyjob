/**
 * Tests that a logAudit failure inside the unlock transaction rolls back
 * the entire unlock (no TalentUnlock, no ledger entry, balance unchanged).
 *
 * This file mocks '@/server/services/audit' at module level so it can verify
 * the rollback behavior without affecting other test files.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('@/server/services/audit', () => ({
  logAudit: vi.fn().mockRejectedValue(new Error('DB write failed')),
}))

import { LedgerReason } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import { unlockStudent } from '@/server/services/unlock'
import { applyLedgerEntry } from '@/server/services/credits'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()

async function seedSettings() {
  for (const [key, value] of [
    ['unlock.enabled', true],
    ['unlock.costCredits', 1],
    ['limits.unlocksPerDay', 50],
    ['talentPool.minCompleteness', 60],
  ] as const) {
    await testDb.systemSetting.upsert({
      where: { key },
      create: { key, value: value as Parameters<typeof testDb.systemSetting.create>[0]['data']['value'] },
      update: { value: value as Parameters<typeof testDb.systemSetting.create>[0]['data']['value'] },
    })
  }
  clearSettingsCache()
}

async function createWallet(companyId: string, balance: number) {
  await testDb.creditWallet.upsert({
    where: { companyId },
    create: { companyId, balance: 0 },
    update: {},
  })
  if (balance > 0) {
    await testDb.$transaction(async (tx) => {
      await applyLedgerEntry(tx, {
        companyId,
        delta: balance,
        reason: LedgerReason.ADMIN_ADJUST,
      })
    })
  }
}

beforeEach(async () => {
  await seedSettings()
})

describe('unlockStudent: audit failure rolls back transaction', () => {
  it('audit throws inside tx → unlock errors, no TalentUnlock, no UNLOCK ledger entry, balance unchanged', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: emp.companyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    await createWallet(emp.companyId, 5)
    const { profileId } = await createStudent(testDb, { completeness: 80 })
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
    })

    await expect(
      unlockStudent({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toThrow()

    // Transaction rolled back: no TalentUnlock record
    const unlocks = await testDb.talentUnlock.findMany({
      where: { companyId: emp.companyId, studentId: profileId },
    })
    expect(unlocks).toHaveLength(0)

    // No UNLOCK ledger entry (only the ADMIN_ADJUST from createWallet remains)
    const unlockLedger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId: emp.companyId }, reason: LedgerReason.UNLOCK },
    })
    expect(unlockLedger).toHaveLength(0)

    // Balance unchanged at 5
    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } })
    expect(wallet?.balance).toBe(5)
  })
})
