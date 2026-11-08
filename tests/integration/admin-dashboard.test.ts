/**
 * Integration tests for admin-dashboard service (M6-T01).
 *
 * Creates known test data and asserts each dashboard metric equals the result
 * of independent direct-DB queries (not calling service helpers).
 *
 * Week-boundary test: two StudentProfile rows created at timestamps that straddle
 * the KL Monday 00:00 boundary must end up in different weeks.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ForbiddenError } from '@/server/errors'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, faker } from '../factories'
import { getDashboardStats } from '@/server/services/admin-dashboard'

setupTestDb()

async function createAdmin() {
  return testDb.user.create({
    data: {
      name: faker.person.fullName(),
      email: `admin-dash-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      emailVerified: true,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  })
}

describe('getDashboardStats — data integrity', () => {
  it('studentCount matches direct DB count of ACTIVE verified students', async () => {
    const admin = await createAdmin()
    // Seed 3 active+verified students, 1 unverified, 1 suspended
    await createStudent(testDb) // active verified
    await createStudent(testDb) // active verified
    await createStudent(testDb) // active verified
    await createStudent(testDb, { emailVerified: false }) // unverified — must NOT count
    // Create a suspended active student
    const { userId: suspId } = await createStudent(testDb)
    await testDb.user.update({ where: { id: suspId }, data: { status: 'SUSPENDED' } })

    const stats = await getDashboardStats({ userId: admin.id })

    const directCount = await testDb.user.count({
      where: { role: 'STUDENT', status: 'ACTIVE', emailVerified: true },
    })
    expect(stats.studentCount).toBe(directCount)
    expect(stats.studentCount).toBeGreaterThanOrEqual(3)
  })

  it('verifiedCompanyCount matches direct DB count', async () => {
    const admin = await createAdmin()
    // Create one verified company and one pending
    await testDb.company.create({
      data: { legalName: faker.company.name(), verificationStatus: 'VERIFIED', isActive: true },
    })
    await testDb.company.create({
      data: { legalName: faker.company.name(), verificationStatus: 'PENDING', isActive: true },
    })

    const stats = await getDashboardStats({ userId: admin.id })

    const directCount = await testDb.company.count({ where: { verificationStatus: 'VERIFIED' } })
    expect(stats.verifiedCompanyCount).toBe(directCount)
  })

  it('applicationCount matches direct DB count', async () => {
    const admin = await createAdmin()

    // Create employer with verified company and a job
    const emp = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: emp.companyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    const job = await testDb.job.create({
      data: {
        companyId: emp.companyId,
        title: faker.person.jobTitle(),
        type: 'INTERNSHIP',
        status: 'PUBLISHED',
        state: 'KUL',
        workMode: 'ONSITE',
        description: 'Test job',
        createdById: emp.userId,
      },
    })
    // Create student and application
    const { profileId } = await createStudent(testDb)
    await testDb.application.create({
      data: { jobId: job.id, studentId: profileId },
    })

    const stats = await getDashboardStats({ userId: admin.id })

    const directCount = await testDb.application.count()
    expect(stats.applicationCount).toBe(directCount)
  })

  it('unlockCount matches direct DB count', async () => {
    const admin = await createAdmin()

    // Create employer with verified company + wallet
    const emp = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: emp.companyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    await testDb.creditWallet.upsert({
      where: { companyId: emp.companyId },
      create: { companyId: emp.companyId, balance: 100 },
      update: {},
    })
    const { profileId } = await createStudent(testDb)
    await testDb.talentUnlock.create({
      data: {
        companyId: emp.companyId,
        studentId: profileId,
        unlockedById: emp.userId,
        source: 'CREDIT',
        creditsSpent: 10,
      },
    })

    const stats = await getDashboardStats({ userId: admin.id })

    const directCount = await testDb.talentUnlock.count()
    expect(stats.unlockCount).toBe(directCount)
  })

  it('creditsGranted and creditsConsumed match direct DB aggregates', async () => {
    const admin = await createAdmin()

    const emp = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: emp.companyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    const wallet = await testDb.creditWallet.upsert({
      where: { companyId: emp.companyId },
      create: { companyId: emp.companyId, balance: 50 },
      update: {},
    })
    // Grant +100
    await testDb.creditLedger.create({
      data: { walletId: wallet.id, delta: 100, balanceAfter: 100, reason: 'PILOT_GRANT' },
    })
    // Consume -50
    await testDb.creditLedger.create({
      data: { walletId: wallet.id, delta: -50, balanceAfter: 50, reason: 'UNLOCK' },
    })

    const stats = await getDashboardStats({ userId: admin.id })

    // Direct counts
    const grantedAgg = await testDb.creditLedger.aggregate({
      _sum: { delta: true },
      where: { delta: { gt: 0 } },
    })
    const consumedAgg = await testDb.creditLedger.aggregate({
      _sum: { delta: true },
      where: { delta: { lt: 0 } },
    })
    expect(stats.creditsGranted).toBe(grantedAgg._sum.delta ?? 0)
    expect(stats.creditsConsumed).toBe(Math.abs(consumedAgg._sum.delta ?? 0))
  })

  it('weeklyRegistrations always has exactly 12 entries', async () => {
    const admin = await createAdmin()
    const stats = await getDashboardStats({ userId: admin.id })
    expect(stats.weeklyRegistrations).toHaveLength(12)
    // All values are non-negative numbers
    for (const entry of stats.weeklyRegistrations) {
      expect(typeof entry.value).toBe('number')
      expect(entry.value).toBeGreaterThanOrEqual(0)
      expect(typeof entry.label).toBe('string')
      expect(entry.label).toMatch(/^\d{2}\/\d{2}$/)
    }
  })

  it('week boundary: two records straddling KL Monday 00:00 land in different weeks', async () => {
    const admin = await createAdmin()

    // KL is UTC+8. Monday 00:00 KL = Sunday 16:00 UTC.
    // We'll use a fixed reference: a Monday in KL time (say week 0).
    // But we can't use absolute dates. Use a relative approach:
    // Find the UTC timestamp for the most recent Monday 00:00 KL (= Sunday 16:00 UTC in the previous week).
    const now = Date.now()
    // Get this week's Monday in KL:
    // today in KL = now + 8h, truncated to week (Monday)
    const klNow = now + 8 * 60 * 60 * 1000
    const klDate = new Date(klNow)
    // day of week: 0=Sunday, 1=Monday, ..., 6=Saturday
    const klDow = klDate.getUTCDay()
    // days since Monday
    const daysSinceMonday = klDow === 0 ? 6 : klDow - 1
    const thisWeekMondayKL = new Date(klDate)
    thisWeekMondayKL.setUTCDate(klDate.getUTCDate() - daysSinceMonday)
    thisWeekMondayKL.setUTCHours(0, 0, 0, 0)
    // Convert KL Monday 00:00 to UTC (subtract 8h)
    const thisWeekMondayUTC = new Date(thisWeekMondayKL.getTime() - 8 * 60 * 60 * 1000)
    // Previous Monday UTC
    const prevWeekMondayUTC = new Date(thisWeekMondayUTC.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Record A: 1 minute BEFORE this week's Monday KL = this week's Sunday 23:59 KL = Sunday 15:59 UTC
    const justBeforeMonday = new Date(thisWeekMondayUTC.getTime() - 60_000)
    // Record B: exactly at this week's Monday 00:00 KL = Sunday 16:00 UTC
    const exactlyMonday = thisWeekMondayUTC

    // Create two StudentProfile rows with these timestamps
    // We create users first, then profiles with specific createdAt using raw SQL
    // Because Prisma doesn't allow overriding @default(now()) in create
    const userA = await testDb.user.create({
      data: {
        name: 'Week Boundary A',
        email: `wb-a-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    const userB = await testDb.user.create({
      data: {
        name: 'Week Boundary B',
        email: `wb-b-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })

    // Insert profiles with explicit createdAt using $executeRaw
    const prevWeekTs = justBeforeMonday.toISOString()
    const thisWeekTs = exactlyMonday.toISOString()
    const idA = `wb-profile-a-${Date.now()}`
    const idB = `wb-profile-b-${Date.now()}`

    await testDb.$executeRaw`
      INSERT INTO "StudentProfile" (id, "userId", "fullName", visibility, completeness, "onboardingStep", "lastActiveAt", "createdAt", "updatedAt")
      VALUES (
        ${idA}, ${userA.id}, 'Week Boundary A', 'HIDDEN'::"Visibility", 0, 1,
        ${prevWeekTs}::timestamptz, ${prevWeekTs}::timestamptz, ${prevWeekTs}::timestamptz
      )
    `
    await testDb.$executeRaw`
      INSERT INTO "StudentProfile" (id, "userId", "fullName", visibility, completeness, "onboardingStep", "lastActiveAt", "createdAt", "updatedAt")
      VALUES (
        ${idB}, ${userB.id}, 'Week Boundary B', 'HIDDEN'::"Visibility", 0, 1,
        ${thisWeekTs}::timestamptz, ${thisWeekTs}::timestamptz, ${thisWeekTs}::timestamptz
      )
    `

    const stats = await getDashboardStats({ userId: admin.id })

    // Find the week buckets that correspond to prevWeek and thisWeek.
    // The service's formatWeekLabel uses getUTCMonth/getUTCDate on the Date Prisma returns from
    // Postgres timestamp-without-timezone (which represents the KL-local Monday 00:00, treated as UTC).
    // So labels are based on the KL local date, not the UTC equivalent.
    // thisWeekMondayKL already has UTC = KL-local date (Nov 2 00:00 UTC = Nov 2 KL local).
    const prevWeekMondayKL = new Date(thisWeekMondayKL.getTime() - 7 * 24 * 60 * 60 * 1000)
    const prevLabel = `${String(prevWeekMondayKL.getUTCMonth() + 1).padStart(2, '0')}/${String(prevWeekMondayKL.getUTCDate()).padStart(2, '0')}`
    const thisLabel = `${String(thisWeekMondayKL.getUTCMonth() + 1).padStart(2, '0')}/${String(thisWeekMondayKL.getUTCDate()).padStart(2, '0')}`

    const prevBucket = stats.weeklyRegistrations.find((w) => w.label === prevLabel)
    const thisBucket = stats.weeklyRegistrations.find((w) => w.label === thisLabel)

    // Both buckets should exist and each should have at least 1 registration
    expect(prevBucket, `prev-week bucket ${prevLabel} not found in ${JSON.stringify(stats.weeklyRegistrations.map(w => w.label))}`).toBeDefined()
    expect(thisBucket, `this-week bucket ${thisLabel} not found in ${JSON.stringify(stats.weeklyRegistrations.map(w => w.label))}`).toBeDefined()
    expect(prevBucket!.value).toBeGreaterThanOrEqual(1)
    expect(thisBucket!.value).toBeGreaterThanOrEqual(1)
  })
})
