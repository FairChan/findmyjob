/**
 * M4-T17 regressions: visibility races, numeric settings, application races,
 * and failures after the unlock transaction commits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbHooks = vi.hoisted(() => ({
  afterUnlockRead: null as null | (() => Promise<void>),
  beforeUnlockCreate: null as null | (() => Promise<void>),
  failProfileUserLookup: false,
  failOwnerLookup: false,
  failLowThresholdLookup: false,
}))

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/services/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/server/services/notify', () => ({
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/server/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Preserve real queries and transactions; hooks control only the race boundary
// or the specific post-commit operation being tested.
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return {
    db: testDb.$extends({
      query: {
        talentUnlock: {
          async findUnique({ args, query }) {
            const result = await query(args)
            if (!result && dbHooks.afterUnlockRead) {
              const hook = dbHooks.afterUnlockRead
              dbHooks.afterUnlockRead = null
              await hook()
            }
            return result
          },
          async create({ args, query }) {
            if (dbHooks.beforeUnlockCreate) await dbHooks.beforeUnlockCreate()
            return query(args)
          },
        },
        studentProfile: {
          async findUnique({ args, query }) {
            if (
              dbHooks.failProfileUserLookup &&
              args.select?.userId === true &&
              Object.keys(args.select).length === 1
            ) {
              throw new Error('student notification recipient lookup failed')
            }
            return query(args)
          },
        },
        companyMember: {
          async findFirst({ args, query }) {
            if (dbHooks.failOwnerLookup) throw new Error('owner lookup failed')
            return query(args)
          },
        },
        systemSetting: {
          async findUnique({ args, query }) {
            if (dbHooks.failLowThresholdLookup && args.where.key === 'credits.lowThreshold') {
              throw new Error('low credit threshold lookup failed')
            }
            return query(args)
          },
        },
      },
    }),
  }
})

import { LedgerReason, Prisma } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createEmployer, createJob, createStudent } from '../factories'
import { unlockStudent } from '@/server/services/unlock'
import { applyToJob } from '@/server/services/applications'
import { applyLedgerEntry } from '@/server/services/credits'
import { clearSettingsCache } from '@/server/services/settings'
import { createNotification } from '@/server/services/notifications'
import { logger } from '@/server/lib/logger'
import * as talentVisibility from '@/server/services/talent-visibility'
import * as dbRateLimit from '@/server/lib/db-rate-limit'
import { NotFoundError, RateLimitedError } from '@/server/errors'

setupTestDb()

beforeEach(async () => {
  dbHooks.afterUnlockRead = null
  dbHooks.beforeUnlockCreate = null
  dbHooks.failProfileUserLookup = false
  dbHooks.failOwnerLookup = false
  dbHooks.failLowThresholdLookup = false
  vi.clearAllMocks()
  clearSettingsCache()
  await testDb.systemSetting.createMany({
    data: [
      { key: 'unlock.enabled', value: true },
      { key: 'unlock.costCredits', value: 1 },
      { key: 'limits.unlocksPerDay', value: 50 },
      { key: 'talentPool.minCompleteness', value: 60 },
    ],
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function seedSetting(key: string, value: Prisma.InputJsonValue) {
  await testDb.systemSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
  clearSettingsCache()
}

async function makeScenario(balance = 5) {
  const emp = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: emp.companyId },
    data: { verificationStatus: 'VERIFIED' },
  })
  await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 0 } })
  if (balance > 0) {
    await testDb.$transaction(async (tx) => {
      await applyLedgerEntry(tx, {
        companyId: emp.companyId,
        delta: balance,
        reason: LedgerReason.ADMIN_ADJUST,
      })
    })
  }
  const student = await createStudent(testDb, { completeness: 80 })
  await testDb.studentProfile.update({
    where: { id: student.profileId },
    data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
  })
  return { emp, student, ctx: { userId: emp.userId, companyId: emp.companyId } }
}

async function expectNoCharge(companyId: string, actorId: string, balance = 5) {
  expect(await testDb.creditWallet.findUnique({ where: { companyId } })).toMatchObject({ balance })
  expect(await testDb.creditLedger.count({
    where: { wallet: { companyId }, reason: LedgerReason.UNLOCK },
  })).toBe(0)
  expect(await testDb.auditLog.count({
    where: { actorId, action: 'talent.unlock' },
  })).toBe(0)
}

async function prepareApplicationRace() {
  const scenario = await makeScenario()
  const job = await createJob(testDb, scenario.emp.companyId, scenario.emp.userId)
  await testDb.jobView.create({
    data: { studentId: scenario.student.profileId, jobId: job.id },
  })
  dbHooks.afterUnlockRead = async () => {
    await applyToJob({ userId: scenario.student.userId }, { jobId: job.id })
  }
  return scenario
}

describe('unlockStudent: recheck visibility inside the transaction', () => {
  it.each(['hidden', 'blocked'] as const)(
    'rejects a student who becomes %s after the first visibility check',
    async (change) => {
      const { emp, student, ctx } = await makeScenario()
      const original = talentVisibility.isStudentVisibleToCompany
      vi.spyOn(talentVisibility, 'isStudentVisibleToCompany').mockImplementationOnce(async (...args) => {
        const visible = await original(...args)
        expect(visible).toBe(true)
        if (change === 'hidden') {
          await testDb.studentProfile.update({
            where: { id: student.profileId },
            data: { visibility: 'HIDDEN' },
          })
        } else {
          await testDb.blockedCompany.create({
            data: { studentId: student.profileId, companyId: emp.companyId },
          })
        }
        return visible
      })

      await expect(unlockStudent(ctx, student.profileId)).rejects.toBeInstanceOf(NotFoundError)

      await expectNoCharge(emp.companyId, emp.userId)
      expect(await testDb.talentUnlock.count({ where: { companyId: emp.companyId } })).toBe(0)
    },
  )
})

describe('unlockStudent: validated settings', () => {
  const invalidValues = [-1, 1.5, 'private-invalid-setting', true, Number.MAX_SAFE_INTEGER + 1]

  it.each(invalidValues)('falls back to a one-credit cost for invalid setting %j', async (value) => {
    await seedSetting('unlock.costCredits', value)
    const { emp, student, ctx } = await makeScenario()

    const result = await unlockStudent(ctx, student.profileId)

    expect(result.alreadyUnlocked).toBe(false)
    expect(await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } }))
      .toMatchObject({ balance: 4 })
    expect(await testDb.talentUnlock.findUnique({ where: { id: result.unlockId } }))
      .toMatchObject({ creditsSpent: 1 })
    expect(vi.mocked(logger.warn).mock.calls).toEqual([
      [{ key: 'unlock.costCredits', defaultValue: 1 }, expect.any(String)],
    ])
  })

  it.each(invalidValues)('falls back to a daily limit of 50 for invalid setting %j', async (value) => {
    await seedSetting('limits.unlocksPerDay', value)
    const { emp, student, ctx } = await makeScenario()
    // Seed today's count explicitly with 49 distinct students for this actor.
    const priorStudents = await Promise.all(
      Array.from({ length: 49 }, () => createStudent(testDb, { completeness: 80 })),
    )
    await testDb.talentUnlock.createMany({
      data: priorStudents.map((prior) => ({
        companyId: emp.companyId,
        studentId: prior.profileId,
        unlockedById: emp.userId,
        source: 'APPLICATION' as const,
        creditsSpent: 0,
        createdAt: new Date(),
      })),
    })

    await expect(unlockStudent(ctx, student.profileId)).resolves.toMatchObject({ alreadyUnlocked: false })
    const next = await createStudent(testDb, { completeness: 80 })
    await testDb.studentProfile.update({
      where: { id: next.profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
    })
    await expect(unlockStudent(ctx, next.profileId)).rejects.toBeInstanceOf(RateLimitedError)
    expect(await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } }))
      .toMatchObject({ balance: 4 })
    const warnings = vi.mocked(logger.warn).mock.calls
    expect(warnings.length).toBeGreaterThan(0)
    for (const warning of warnings) {
      expect(warning).toEqual([{ key: 'limits.unlocksPerDay', defaultValue: 50 }, expect.any(String)])
    }
  })

  it('accepts zero cost without a warning and records a free unlock', async () => {
    await seedSetting('unlock.costCredits', 0)
    const { emp, student, ctx } = await makeScenario(0)

    const result = await unlockStudent(ctx, student.profileId)

    expect(result.alreadyUnlocked).toBe(false)
    expect(await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } }))
      .toMatchObject({ balance: 0 })
    const ledger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId: emp.companyId }, reason: LedgerReason.UNLOCK },
    })
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ delta: 0, refId: result.unlockId })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('accepts a zero daily limit and refuses the first unlock without a warning', async () => {
    await seedSetting('limits.unlocksPerDay', 0)
    const { emp, student, ctx } = await makeScenario()

    await expect(unlockStudent(ctx, student.profileId)).rejects.toBeInstanceOf(RateLimitedError)

    await expectNoCharge(emp.companyId, emp.userId)
    expect(await testDb.talentUnlock.count({ where: { companyId: emp.companyId } })).toBe(0)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('unlockStudent: application competition', () => {
  it('returns the committed APPLICATION unlock after a real unique conflict without charging', async () => {
    const { emp, student, ctx } = await prepareApplicationRace()

    const result = await unlockStudent(ctx, student.profileId)

    const rows = await testDb.talentUnlock.findMany({
      where: { companyId: emp.companyId, studentId: student.profileId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'APPLICATION', creditsSpent: 0 })
    expect(result).toEqual({ unlockId: rows[0].id, alreadyUnlocked: true })
    expect(await testDb.application.count({ where: { studentId: student.profileId } })).toBe(1)
    await expectNoCharge(emp.companyId, emp.userId)
    expect(vi.mocked(createNotification).mock.calls.filter((call) => call[2] === 'talent.unlock'))
      .toHaveLength(0)
  })

  it.each([
    { modelName: 'TalentUnlock', target: ['id'] },
    { modelName: 'CreditLedger', target: ['companyId', 'studentId'] },
    { target: ['id'] },
  ])('does not swallow unrelated P2002 metadata %j even when an APPLICATION row exists', async (meta) => {
    const { emp, student, ctx } = await prepareApplicationRace()
    const failure = new Prisma.PrismaClientKnownRequestError('unrelated unique conflict', {
      code: 'P2002',
      clientVersion: 'test',
      meta,
    })
    dbHooks.beforeUnlockCreate = async () => { throw failure }

    await expect(unlockStudent(ctx, student.profileId)).rejects.toBe(failure)

    await expectNoCharge(emp.companyId, emp.userId)
    expect(await testDb.talentUnlock.count({
      where: { companyId: emp.companyId, studentId: student.profileId, source: 'APPLICATION' },
    })).toBe(1)
  })
})

describe('unlockStudent: post-commit failure isolation', () => {
  it.each(['student lookup', 'threshold lookup', 'rate limit', 'owner lookup'] as const)(
    'returns a successful unlock when the %s notification dependency fails',
    async (dependency) => {
      const { emp, student, ctx } = await makeScenario()
      if (dependency === 'student lookup') dbHooks.failProfileUserLookup = true
      if (dependency === 'threshold lookup') dbHooks.failLowThresholdLookup = true
      if (dependency === 'owner lookup') dbHooks.failOwnerLookup = true
      if (dependency === 'rate limit') {
        vi.spyOn(dbRateLimit, 'hitBucket').mockRejectedValueOnce(new Error('notification bucket failed'))
      }

      const result = await unlockStudent(ctx, student.profileId)

      expect(result.alreadyUnlocked).toBe(false)
      expect(await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } }))
        .toMatchObject({ balance: 4 })
      expect(await testDb.talentUnlock.count({
        where: { id: result.unlockId, companyId: emp.companyId, studentId: student.profileId },
      })).toBe(1)
      const ledger = await testDb.creditLedger.findMany({
        where: { wallet: { companyId: emp.companyId }, reason: LedgerReason.UNLOCK },
      })
      expect(ledger).toHaveLength(1)
      expect(ledger[0]).toMatchObject({ delta: -1, refId: result.unlockId })
      expect(await testDb.auditLog.count({
        where: { actorId: emp.userId, action: 'talent.unlock', targetId: result.unlockId },
      })).toBe(1)
    },
  )
})
