/**
 * Integration tests for unlock service (M4-T07).
 *
 * Tests the core unlock transaction semantics:
 * - concurrent 10 unlocks with balance 3 → exactly 3 succeed
 * - concurrent duplicate unlocks (same student) → only 1 charge
 * - blocked student → NotFoundError
 * - hidden student → NotFoundError
 * - feature disabled → FeatureDisabledError
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import { unlockStudent } from '@/server/services/unlock'
import { clearSettingsCache } from '@/server/services/settings'
import {
  NotFoundError,
  RateLimitedError,
  InsufficientCreditsError,
  FeatureDisabledError,
} from '@/server/errors'

setupTestDb()

// Store values directly (not JSON.stringify) so Prisma JSONB stores booleans/numbers natively.
async function seedSettings(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    'unlock.enabled': true,
    'unlock.costCredits': 1,
    'limits.unlocksPerDay': 50,
    'talentPool.minCompleteness': 60,
  }
  const settings = { ...defaults, ...overrides }
  for (const [key, value] of Object.entries(settings)) {
    await testDb.systemSetting.upsert({
      where: { key },
      create: { key, value: value as Parameters<typeof testDb.systemSetting.create>[0]['data']['value'] },
      update: { value: value as Parameters<typeof testDb.systemSetting.create>[0]['data']['value'] },
    })
  }
  // Clear 60-second in-memory cache so the new values are picked up immediately.
  clearSettingsCache()
}

async function createVerifiedEmployer() {
  const emp = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: emp.companyId },
    data: { verificationStatus: 'VERIFIED' },
  })
  return emp
}

async function createWallet(companyId: string, balance: number) {
  return testDb.creditWallet.upsert({
    where: { companyId },
    create: { companyId, balance },
    update: { balance },
  })
}

async function createVisibleStudent(overrides?: { completeness?: number }) {
  const result = await createStudent(testDb, {
    completeness: overrides?.completeness ?? 80,
  })
  await testDb.studentProfile.update({
    where: { id: result.profileId },
    data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
  })
  return result
}

beforeEach(async () => {
  await seedSettings()
})

describe('unlockStudent: basic', () => {
  it('unlocks a visible student, deducts 1 credit, writes audit', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 5)
    const student = await createVisibleStudent()

    const result = await unlockStudent(
      { userId: emp.userId, companyId: emp.companyId },
      student.profileId,
    )
    expect(result.alreadyUnlocked).toBe(false)
    expect(result.unlockId).toBeTruthy()

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } })
    expect(wallet?.balance).toBe(4)

    const ledger = await testDb.creditLedger.findMany({ where: { wallet: { companyId: emp.companyId } } })
    expect(ledger).toHaveLength(1)
    expect(ledger[0].delta).toBe(-1)
    expect(ledger[0].refType).toBe('TalentUnlock')
  })

  it('duplicate unlock returns alreadyUnlocked=true, no credit deducted', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 5)
    const student = await createVisibleStudent()
    const ctx = { userId: emp.userId, companyId: emp.companyId }

    await unlockStudent(ctx, student.profileId)
    const result = await unlockStudent(ctx, student.profileId)
    expect(result.alreadyUnlocked).toBe(true)

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } })
    expect(wallet?.balance).toBe(4) // only 1 credit deducted
  })

  it('hidden student → NotFoundError', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 5)
    const { profileId } = await createStudent(testDb, { completeness: 80 })
    // Profile stays HIDDEN (default)

    await expect(
      unlockStudent({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('blocked student → NotFoundError', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 5)
    const student = await createVisibleStudent()
    await testDb.blockedCompany.create({
      data: { studentId: student.profileId, companyId: emp.companyId },
    })

    await expect(
      unlockStudent({ userId: emp.userId, companyId: emp.companyId }, student.profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('insufficient credits → InsufficientCreditsError', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 0)
    const student = await createVisibleStudent()

    await expect(
      unlockStudent({ userId: emp.userId, companyId: emp.companyId }, student.profileId),
    ).rejects.toBeInstanceOf(InsufficientCreditsError)
  })

  it('feature disabled → FeatureDisabledError', async () => {
    await seedSettings({ 'unlock.enabled': false })
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 10)
    const student = await createVisibleStudent()

    await expect(
      unlockStudent({ userId: emp.userId, companyId: emp.companyId }, student.profileId),
    ).rejects.toBeInstanceOf(FeatureDisabledError)
  })

  it('daily limit reached → RateLimitedError', async () => {
    await seedSettings({ 'limits.unlocksPerDay': 1 })
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 10)
    const s1 = await createVisibleStudent()
    const s2 = await createVisibleStudent()

    await unlockStudent({ userId: emp.userId, companyId: emp.companyId }, s1.profileId)
    await expect(
      unlockStudent({ userId: emp.userId, companyId: emp.companyId }, s2.profileId),
    ).rejects.toBeInstanceOf(RateLimitedError)
  })
})

describe('unlockStudent: concurrency', () => {
  it('balance 3, 10 concurrent different-student unlocks → exactly 3 succeed', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 3)
    const students = await Promise.all(
      Array.from({ length: 10 }, () => createVisibleStudent()),
    )

    const results = await Promise.allSettled(
      students.map((s) =>
        unlockStudent({ userId: emp.userId, companyId: emp.companyId }, s.profileId),
      ),
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled')
    const failed = results.filter((r) => r.status === 'rejected')
    expect(succeeded).toHaveLength(3)
    expect(failed).toHaveLength(7)
    expect(
      failed.every(
        (r) => r.status === 'rejected' && r.reason instanceof InsufficientCreditsError,
      ),
    ).toBe(true)

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } })
    expect(wallet?.balance).toBe(0)
  })

  it('concurrent duplicate unlocks for same student → only 1 charge', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 10)
    const student = await createVisibleStudent()

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        unlockStudent({ userId: emp.userId, companyId: emp.companyId }, student.profileId),
      ),
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled')
    expect(succeeded.length).toBeGreaterThanOrEqual(1)

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } })
    // Only 1 credit deducted regardless of concurrency
    expect(wallet?.balance).toBe(9)

    const unlocks = await testDb.talentUnlock.findMany({
      where: { companyId: emp.companyId, studentId: student.profileId },
    })
    expect(unlocks).toHaveLength(1)
  })
})
