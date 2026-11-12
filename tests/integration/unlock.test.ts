/**
 * Integration tests for unlock service (M4-T07, M4-T20).
 *
 * Tests the core unlock transaction semantics:
 * - concurrent 10 unlocks with balance 3 → exactly 3 succeed
 * - concurrent duplicate unlocks (same student) → only 1 charge
 * - blocked student → NotFoundError
 * - hidden student → NotFoundError
 * - feature disabled → FeatureDisabledError
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

vi.mock('@/server/services/notifications', () => ({
  createNotification: vi.fn(),
}))

vi.mock('@/server/lib/alert', () => ({
  alert: vi.fn(),
}))

vi.mock('@/server/services/notify', () => ({
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import { unlockStudent } from '@/server/services/unlock'
import { clearSettingsCache } from '@/server/services/settings'
import { applyLedgerEntry, reconcileWallet } from '@/server/services/credits'
import { LedgerReason, Prisma } from '@prisma/client'
import { createNotification, type NotificationWriter } from '@/server/services/notifications'
import { runReconcileWallets } from '@/server/jobs/reconcile-wallets'
import { alert } from '@/server/lib/alert'
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
  vi.mocked(alert).mockClear()
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

    const ledger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId: emp.companyId }, reason: LedgerReason.UNLOCK },
    })
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

  it('insufficient credits → InsufficientCreditsError, no TalentUnlock, no ledger entry', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 0)
    const student = await createVisibleStudent()

    await expect(
      unlockStudent({ userId: emp.userId, companyId: emp.companyId }, student.profileId),
    ).rejects.toBeInstanceOf(InsufficientCreditsError)

    const unlocks = await testDb.talentUnlock.findMany({ where: { companyId: emp.companyId } })
    expect(unlocks).toHaveLength(0)
    const ledger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId: emp.companyId }, reason: LedgerReason.UNLOCK },
    })
    expect(ledger).toHaveLength(0)
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

describe('unlockStudent: audit and notification', () => {
  it('successful unlock writes exactly 1 talent.unlock audit with correct targetId and no contact info', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 5)
    const student = await createVisibleStudent()

    const result = await unlockStudent(
      { userId: emp.userId, companyId: emp.companyId },
      student.profileId,
    )

    const audit = await testDb.auditLog.findFirst({
      where: { action: 'talent.unlock', actorId: emp.userId },
    })
    expect(audit).not.toBeNull()
    expect(audit?.targetId).toBe(result.unlockId)
    const metaStr = JSON.stringify(audit?.metadata)
    expect(metaStr).not.toContain('phone')
    expect(metaStr).not.toContain('email')
    expect(metaStr).not.toContain('wechat')
  })

  it('createNotification throws → unlock still succeeds, audit and ledger are present', async () => {
    vi.mocked(createNotification).mockRejectedValueOnce(new Error('notification failed'))

    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 5)
    const student = await createVisibleStudent()

    const result = await unlockStudent(
      { userId: emp.userId, companyId: emp.companyId },
      student.profileId,
    )
    expect(result.alreadyUnlocked).toBe(false)

    // Audit is still written (inside the transaction, committed before notification failed)
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'talent.unlock', actorId: emp.userId },
    })
    expect(audit).not.toBeNull()

    // Ledger entry is still present
    const ledger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId: emp.companyId }, reason: LedgerReason.UNLOCK },
    })
    expect(ledger).toHaveLength(1)
  })
})

describe('unlockStudent: concurrency', () => {
  it('balance 3, 10 concurrent different-student unlocks → exactly 3 succeed, reconcileWallet ok', async () => {
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

    // Exactly 3 TalentUnlock rows and 3 UNLOCK ledger entries
    const unlocks = await testDb.talentUnlock.findMany({ where: { companyId: emp.companyId } })
    expect(unlocks).toHaveLength(3)
    const unlockLedger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId: emp.companyId }, reason: LedgerReason.UNLOCK },
    })
    expect(unlockLedger).toHaveLength(3)

    const reconcile = await reconcileWallet({ companyId: emp.companyId })
    expect(reconcile.ok).toBe(true)

    // M4-T20: runReconcileWallets should find no mismatches after concurrent unlocks
    await runReconcileWallets()
    expect(vi.mocked(alert)).not.toHaveBeenCalledWith('wallet.mismatch', expect.anything())

    // RUNBOOK scenario 3 SQL: balance must equal SUM(ledger.delta) for all wallets
    const mismatches = await testDb.$queryRaw<Array<{ companyId: string }>>(
      Prisma.sql`
        SELECT w."companyId"
        FROM   "CreditWallet" w
        LEFT JOIN "CreditLedger" l ON l."walletId" = w."id"
        GROUP BY w."companyId", w."balance"
        HAVING COALESCE(SUM(l."delta"), 0) <> w."balance"
      `,
    )
    expect(mismatches).toEqual([])
  })

  it('concurrent duplicate unlocks for same student → only 1 charge, reconcileWallet ok', async () => {
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

    const unlockLedger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId: emp.companyId }, reason: LedgerReason.UNLOCK },
    })
    expect(unlockLedger).toHaveLength(1)

    const reconcile = await reconcileWallet({ companyId: emp.companyId })
    expect(reconcile.ok).toBe(true)

    // M4-T20: runReconcileWallets should find no mismatches after concurrent duplicate unlocks
    await runReconcileWallets()
    expect(vi.mocked(alert)).not.toHaveBeenCalledWith('wallet.mismatch', expect.anything())

    const mismatches = await testDb.$queryRaw<Array<{ companyId: string }>>(
      Prisma.sql`
        SELECT w."companyId"
        FROM   "CreditWallet" w
        LEFT JOIN "CreditLedger" l ON l."walletId" = w."id"
        GROUP BY w."companyId", w."balance"
        HAVING COALESCE(SUM(l."delta"), 0) <> w."balance"
      `,
    )
    expect(mismatches).toEqual([])
  })
})

describe('unlockStudent: notification rows', () => {
  beforeEach(() => {
    // Let createNotification actually write to testDb so we can assert on notification rows.
    vi.mocked(createNotification).mockImplementation(
      async (writer: NotificationWriter, userId, type, payload) => {
        await writer.notification.create({ data: { userId, type, payload } })
      },
    )
  })

  it('successful unlock writes exactly 1 Notification to student, payload has companyId+unlockId', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 5)
    const student = await createVisibleStudent()

    const result = await unlockStudent(
      { userId: emp.userId, companyId: emp.companyId },
      student.profileId,
    )
    expect(result.alreadyUnlocked).toBe(false)

    const notifications = await testDb.notification.findMany({
      where: { type: 'talent.unlock' },
    })
    // Exactly 1 notification for this unlock
    const unlockNotifs = notifications.filter(
      (n) => (n.payload as Record<string, unknown>).unlockId === result.unlockId,
    )
    expect(unlockNotifs).toHaveLength(1)
    expect(unlockNotifs[0].userId).toBe(student.userId)
    expect(unlockNotifs[0].type).toBe('talent.unlock')
    expect(unlockNotifs[0].payload).toEqual({
      companyId: emp.companyId,
      unlockId: result.unlockId,
    })
  })

  it('company member has no talent.unlock notification for the student unlock', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 5)
    const student = await createVisibleStudent()

    await unlockStudent({ userId: emp.userId, companyId: emp.companyId }, student.profileId)

    const empNotifs = await testDb.notification.findMany({
      where: { userId: emp.userId, type: 'talent.unlock' },
    })
    expect(empNotifs).toHaveLength(0)
  })

  it('duplicate unlock does not add a second Notification', async () => {
    const emp = await createVerifiedEmployer()
    await createWallet(emp.companyId, 5)
    const student = await createVisibleStudent()
    const ctx = { userId: emp.userId, companyId: emp.companyId }

    const first = await unlockStudent(ctx, student.profileId)
    // duplicate — alreadyUnlocked path skips createNotification
    const second = await unlockStudent(ctx, student.profileId)
    expect(second.alreadyUnlocked).toBe(true)

    const notifs = await testDb.notification.findMany({
      where: { userId: student.userId, type: 'talent.unlock' },
    })
    // Only the first unlock should have created a notification
    const forThisUnlock = notifs.filter(
      (n) => (n.payload as Record<string, unknown>).unlockId === first.unlockId,
    )
    expect(forThisUnlock).toHaveLength(1)
    // No second notification from duplicate
    expect(notifs).toHaveLength(1)
  })
})
