/**
 * Integration tests for getProfileViews: DISTINCT ON (companyId, KL-date) logic.
 *
 * Tests the SQL deduplication by KL calendar day (UTC+8), not just per-company.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/env', () => ({ env: {} }))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('@/server/services/settings', () => ({ getSetting: vi.fn() }))

import { Prisma } from '@prisma/client'
import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import { getProfileViews } from '@/server/services/privacy'

setupTestDb()

/**
 * Return two UTC timestamps that:
 *  - both fall on the SAME KL (UTC+8) calendar day
 *  - are daysAgo KL-days in the past (always within the 90-day rolling window)
 *
 * UTC 16:00 is KL midnight, so a KL-day spans [prevUTC16:00, UTC16:00).
 * We pick:
 *   t1 = KL-midnight-offset + 30 min  (UTC 16:30 = KL 00:30 of that day)
 *   t2 = t1 + 2.5 hours                (UTC 19:00 = KL 03:00 of the same day)
 */
function klSameDayPair(daysAgo: number): [Date, Date] {
  const KL_OFFSET_MS = 8 * 3600 * 1000
  const DAY_MS = 24 * 3600 * 1000
  // UTC timestamp of the KL midnight that is `daysAgo` KL-days before now
  const nowKlDay = Math.floor((Date.now() + KL_OFFSET_MS) / DAY_MS)
  const targetKlDayMs = (nowKlDay - daysAgo) * DAY_MS - KL_OFFSET_MS
  const t1 = new Date(targetKlDayMs + 30 * 60 * 1000)      // UTC 00:30 past KL midnight
  const t2 = new Date(targetKlDayMs + 2.5 * 3600 * 1000)   // UTC 02:30 past KL midnight (same KL day)
  return [t1, t2]
}

/**
 * Two UTC timestamps on DIFFERENT KL calendar days, `daysAgo` KL-days ago.
 *   t1 = 30 min before KL midnight  (UTC 15:30 = KL 23:30 of day-1)
 *   t2 = 30 min after  KL midnight  (UTC 16:30 = KL 00:30 of day)
 */
function klDifferentDayPair(daysAgo: number): [Date, Date] {
  const KL_OFFSET_MS = 8 * 3600 * 1000
  const DAY_MS = 24 * 3600 * 1000
  const nowKlDay = Math.floor((Date.now() + KL_OFFSET_MS) / DAY_MS)
  const targetKlDayMs = (nowKlDay - daysAgo) * DAY_MS - KL_OFFSET_MS
  const t1 = new Date(targetKlDayMs - 30 * 60 * 1000)  // 30 min before KL midnight (prev KL day)
  const t2 = new Date(targetKlDayMs + 30 * 60 * 1000)  // 30 min after  KL midnight (this KL day)
  return [t1, t2]
}

beforeEach(() => {
  vi.clearAllMocks()
})

async function setupStudentAndCompany() {
  const student = await createStudent(testDb, { completeness: 80 })
  await testDb.studentProfile.update({
    where: { id: student.profileId },
    data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
  })

  const empA = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: empA.companyId },
    data: { verificationStatus: 'VERIFIED', legalName: 'Company A' },
  })
  const empAUser = empA.userId

  const empB = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: empB.companyId },
    data: { verificationStatus: 'VERIFIED', legalName: 'Company B' },
  })
  const empBUser = empB.userId

  return { student, companyAId: empA.companyId, companyBId: empB.companyId, empAUser, empBUser }
}

async function insertView(studentId: string, companyId: string, viewerId: string, createdAt: Date) {
  // Insert with explicit timestamp via raw SQL since Prisma doesn't allow overriding @default(now())
  const id = `pv_${Math.random().toString(36).slice(2)}`
  await testDb.$executeRaw(Prisma.sql`
    INSERT INTO "ProfileView" ("id", "companyId", "studentId", "viewerId", "createdAt")
    VALUES (${id}, ${companyId}, ${studentId}, ${viewerId}, ${createdAt})
  `)
}

describe('getProfileViews: DISTINCT ON KL-date deduplication', () => {
  it('two views by company A on same KL day → 1 row', async () => {
    const { student, companyAId, empAUser } = await setupStudentAndCompany()

    // Both timestamps fall on the same KL (UTC+8) calendar day, 2 days ago
    const [t1, t2] = klSameDayPair(2)
    await insertView(student.profileId, companyAId, empAUser, t1)
    await insertView(student.profileId, companyAId, empAUser, t2)

    const views = await getProfileViews({ userId: student.userId })
    const aViews = views.filter((v) => v.companyId === companyAId)
    expect(aViews).toHaveLength(1)
    // Should pick the later timestamp within the KL-day bucket
    expect(aViews[0].viewedAt.getTime()).toBe(t2.getTime())
  })

  it('company A on two different KL days → 2 rows', async () => {
    const { student, companyAId, empAUser } = await setupStudentAndCompany()

    // t1 is on KL day X-1, t2 is on KL day X (they straddle a KL midnight, 2 days ago)
    const [t1, t2] = klDifferentDayPair(2)
    await insertView(student.profileId, companyAId, empAUser, t1)
    await insertView(student.profileId, companyAId, empAUser, t2)

    const views = await getProfileViews({ userId: student.userId })
    const aViews = views.filter((v) => v.companyId === companyAId)
    expect(aViews).toHaveLength(2)
  })

  it('company B 89 days ago is included', async () => {
    const { student, companyBId, empBUser } = await setupStudentAndCompany()

    const eightNineAgo = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000)
    await insertView(student.profileId, companyBId, empBUser, eightNineAgo)

    const views = await getProfileViews({ userId: student.userId })
    const bViews = views.filter((v) => v.companyId === companyBId)
    expect(bViews).toHaveLength(1)
  })

  it('company B 91 days ago is excluded', async () => {
    const { student, companyBId, empBUser } = await setupStudentAndCompany()

    const ninetyOneAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000)
    await insertView(student.profileId, companyBId, empBUser, ninetyOneAgo)

    const views = await getProfileViews({ userId: student.userId })
    const bViews = views.filter((v) => v.companyId === companyBId)
    expect(bViews).toHaveLength(0)
  })

  it("another student's views are excluded", async () => {
    const { student, companyAId, empAUser } = await setupStudentAndCompany()
    const otherStudent = await createStudent(testDb, { completeness: 80 })
    await testDb.studentProfile.update({
      where: { id: otherStudent.profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
    })

    // Insert a view for the OTHER student from company A
    await insertView(otherStudent.profileId, companyAId, empAUser, new Date())

    const views = await getProfileViews({ userId: student.userId })
    expect(views.filter((v) => v.companyId === companyAId)).toHaveLength(0)
  })

  it('returns at most 200 rows', async () => {
    const { student, empAUser } = await setupStudentAndCompany()

    // Create 205 companies and 1 view each
    const employers = await Promise.all(
      Array.from({ length: 205 }, () => createEmployer(testDb)),
    )
    await Promise.all(
      employers.map((e) =>
        testDb.company.update({
          where: { id: e.companyId },
          data: { verificationStatus: 'VERIFIED' },
        }),
      ),
    )
    await Promise.all(
      employers.map((e, i) =>
        insertView(
          student.profileId,
          e.companyId,
          empAUser,
          new Date(Date.now() - i * 60 * 1000),
        ),
      ),
    )

    const views = await getProfileViews({ userId: student.userId })
    expect(views.length).toBeLessThanOrEqual(200)
  })
})
