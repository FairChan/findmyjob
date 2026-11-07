/**
 * Integration tests for talent-view service (M4-T05).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import { viewTalentProfile } from '@/server/services/talent-view'
import { setSetting } from '@/server/services/settings'
import { NotFoundError, RateLimitedError, ForbiddenError } from '@/server/errors'
import { encryptField } from '@/server/lib/crypto'

setupTestDb()

beforeEach(() => {
  vi.clearAllMocks()
})

// Make a student visible (PUBLIC + schoolVerifiedAt set + sufficient completeness)
async function makeStudentVisible(
  profileId: string,
  options: { completeness?: number } = {},
) {
  await testDb.studentProfile.update({
    where: { id: profileId },
    data: {
      visibility: 'PUBLIC',
      schoolVerifiedAt: new Date(),
      completeness: options.completeness ?? 80,
    },
  })
}

// Verify company
async function verifyCompany(companyId: string) {
  await testDb.company.update({
    where: { id: companyId },
    data: { verificationStatus: 'VERIFIED' },
  })
}

// ---- Tests ----

describe('viewTalentProfile', () => {
  it('returns 404 for a HIDDEN student', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)

    // Student is HIDDEN by default
    await expect(
      viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns 404 for a student who has blocked the company', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeStudentVisible(profileId)

    // Student blocks the company
    await testDb.blockedCompany.create({
      data: { studentId: profileId, companyId: emp.companyId },
    })

    await expect(
      viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('records ProfileView and audit on successful view', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeStudentVisible(profileId)

    await viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId)

    const views = await testDb.profileView.findMany({
      where: { studentId: profileId, companyId: emp.companyId },
    })
    expect(views).toHaveLength(1)
    expect(views[0].viewerId).toBe(emp.userId)

    const audits = await testDb.auditLog.findMany({
      where: { action: 'talent.view', targetId: profileId },
    })
    expect(audits).toHaveLength(1)
  })

  it('repeated views by same viewer on same day are deduped to 1 ProfileView record', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeStudentVisible(profileId)

    // Set member limit to 1 and view 5 times; all 5 should succeed since it is the same student
    await setSetting('limits.profileViewsPerDay', 1)

    for (let i = 0; i < 5; i++) {
      await viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId)
    }

    // Dedup: only 1 ProfileView row should exist for this viewer+student+day
    const views = await testDb.profileView.findMany({
      where: { studentId: profileId, companyId: emp.companyId },
    })
    expect(views).toHaveLength(1)
  })

  it('blocks a new view after member-level limit is hit', async () => {
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)

    // Set member limit to 2 (setSetting clears the cache)
    await setSetting('limits.profileViewsPerDay', 2)

    // Create 3 visible students
    const students = await Promise.all([
      createStudent(testDb),
      createStudent(testDb),
      createStudent(testDb),
    ])
    for (const s of students) await makeStudentVisible(s.profileId)

    // View first 2: OK
    await viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, students[0].profileId)
    await viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, students[1].profileId)

    // 3rd view should be blocked
    await expect(
      viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, students[2].profileId),
    ).rejects.toBeInstanceOf(RateLimitedError)

    // audit talent.limit.hit written
    const audits = await testDb.auditLog.findMany({ where: { action: 'talent.limit.hit' } })
    expect(audits.length).toBeGreaterThanOrEqual(1)
  })

  it('concurrent views are serialized by lock — exactly companyLimit succeed', async () => {
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    // Company limit 2, member limit high so it does not interfere
    await setSetting('limits.companyProfileViewsPerDay', 2)
    await setSetting('limits.profileViewsPerDay', 999)

    const students = await Promise.all(Array.from({ length: 5 }, () => createStudent(testDb)))
    for (const s of students) await makeStudentVisible(s.profileId)

    const results = await Promise.allSettled(
      students.map((s) =>
        viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, s.profileId),
      ),
    )
    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    expect(succeeded).toBe(2)
    expect(results.filter((r) => r.status === 'rejected').length).toBe(3)
  })

  it('blocks after company-level limit when two members together hit the cap', async () => {
    // Create a company with two members
    const ownerEmp = await createEmployer(testDb)
    await verifyCompany(ownerEmp.companyId)

    const member2User = await testDb.user.create({
      data: {
        name: 'Member Two',
        email: 'member2-view-test@example.test',
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    await testDb.companyMember.create({
      data: { userId: member2User.id, companyId: ownerEmp.companyId, role: 'RECRUITER' },
    })

    // Set company limit to 2, high member limit so it doesn't interfere (setSetting clears cache)
    await setSetting('limits.companyProfileViewsPerDay', 2)
    await setSetting('limits.profileViewsPerDay', 999)

    const students = await Promise.all([
      createStudent(testDb),
      createStudent(testDb),
      createStudent(testDb),
    ])
    for (const s of students) await makeStudentVisible(s.profileId)

    // Owner views student 0
    await viewTalentProfile({ userId: ownerEmp.userId, companyId: ownerEmp.companyId }, students[0].profileId)
    // Member2 views student 1
    await viewTalentProfile({ userId: member2User.id, companyId: ownerEmp.companyId }, students[1].profileId)
    // Company has now viewed 2 unique students — the 3rd view should be blocked
    await expect(
      viewTalentProfile({ userId: ownerEmp.userId, companyId: ownerEmp.companyId }, students[2].profileId),
    ).rejects.toBeInstanceOf(RateLimitedError)
  })
})

// ---------------------------------------------------------------------------
// Identity reveal: canSeeIdentity controls unlocked flag and contact (M4-T18)
// ---------------------------------------------------------------------------

async function createUnlock(companyId: string, studentId: string, userId: string) {
  await testDb.creditWallet.upsert({
    where: { companyId },
    create: { companyId, balance: 10 },
    update: {},
  })
  return testDb.talentUnlock.create({
    data: { companyId, studentId, unlockedById: userId, source: 'CREDIT', creditsSpent: 1 },
  })
}

function aad(field: string, studentId: string): string {
  return `StudentContact.${field}:${studentId}`
}

describe('viewTalentProfile: identity reveal via canSeeIdentity', () => {
  it('(a) verified company + TalentUnlock + StudentContact → unlocked=true, full name, all 5 contact fields decrypted', async () => {
    const { profileId, name } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeStudentVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    const phone = '+60123456789'
    const email = 'student-contact@example.test'
    const whatsapp = '+60198765432'
    const wechat = 'wx_handle_test'
    const linkedinUrl = 'https://www.linkedin.com/in/test-student'

    await testDb.studentContact.create({
      data: {
        studentId: profileId,
        phone: encryptField(phone, aad('phone', profileId)),
        email: encryptField(email, aad('email', profileId)),
        whatsapp: encryptField(whatsapp, aad('whatsapp', profileId)),
        wechat: encryptField(wechat, aad('wechat', profileId)),
        linkedinUrl: encryptField(linkedinUrl, aad('linkedinUrl', profileId)),
      },
    })

    const detail = await viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId)

    expect(detail.unlocked).toBe(true)
    expect(detail.name).toBe(name)
    expect(detail.contact?.phone).toBe(phone)
    expect(detail.contact?.email).toBe(email)
    expect(detail.contact?.whatsapp).toBe(whatsapp)
    expect(detail.contact?.wechat).toBe(wechat)
    expect(detail.contact?.linkedinUrl).toBe(linkedinUrl)
  })

  it('(b) no TalentUnlock → unlocked=false, masked name, contact=null', async () => {
    const { profileId, name } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeStudentVisible(profileId)
    // No TalentUnlock created

    const detail = await viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId)

    expect(detail.unlocked).toBe(false)
    expect(detail.name).not.toBe(name) // masked
    expect(detail.contact).toBeNull()
  })

  it('(c) after unlock: student blocks company → viewTalentProfile throws NotFoundError', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeStudentVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    // Student blocks the company after unlock
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId: emp.companyId } })

    await expect(
      viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('(c) after unlock: account SUSPENDED → viewTalentProfile throws NotFoundError', async () => {
    const { profileId, userId: studentUserId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeStudentVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    await testDb.user.update({ where: { id: studentUserId }, data: { status: 'SUSPENDED' } })

    await expect(
      viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('(c) after unlock: account DELETED → viewTalentProfile throws NotFoundError', async () => {
    const { profileId, userId: studentUserId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeStudentVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    await testDb.user.update({ where: { id: studentUserId }, data: { status: 'DELETED' } })

    await expect(
      viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('(c) after unlock: company verification revoked → viewTalentProfile throws ForbiddenError', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeStudentVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    // Revoke company verification
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'REJECTED' } })

    await expect(
      viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
