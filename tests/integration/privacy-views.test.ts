/**
 * Integration tests for getProfileViews: DISTINCT ON (companyId, KL-date) logic.
 *
 * Tests the SQL deduplication by KL calendar day (UTC+8), not just per-company.
 */
import { vi, describe, it, expect } from 'vitest'

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

    // 2026-11-04T16:30Z and 2026-11-05T03:00Z → both are 2026-11-05 in KL (UTC+8)
    await insertView(student.profileId, companyAId, empAUser, new Date('2026-11-04T16:30:00Z'))
    await insertView(student.profileId, companyAId, empAUser, new Date('2026-11-05T03:00:00Z'))

    const views = await getProfileViews({ userId: student.userId })
    const aViews = views.filter((v) => v.companyId === companyAId)
    expect(aViews).toHaveLength(1)
    // Should pick the later timestamp within the KL-day bucket
    expect(aViews[0].viewedAt.toISOString()).toBe('2026-11-05T03:00:00.000Z')
  })

  it('company A on two different KL days → 2 rows', async () => {
    const { student, companyAId, empAUser } = await setupStudentAndCompany()

    // 2026-11-04T15:30Z = 2026-11-04 23:30 KL (same day)
    // 2026-11-04T16:30Z = 2026-11-05 00:30 KL (next day)
    await insertView(student.profileId, companyAId, empAUser, new Date('2026-11-04T15:30:00Z'))
    await insertView(student.profileId, companyAId, empAUser, new Date('2026-11-04T16:30:00Z'))

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
