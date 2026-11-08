/**
 * Integration tests for M5-T07: invitations service.
 *
 * Tests:
 * - Quota exceeded is rejected (KL natural-month boundary)
 * - Concurrent send does not exceed quota
 * - Invisible student (blocked or not visible) cannot be invited
 * - Accept creates application and links applicationId
 * - Expired invitation (expiresAt < now) is rejected on accept
 * - Student cannot accept someone else's invitation
 * - Duplicate accept is rejected
 * - Expire-invitations job only changes SENT+expired rows
 * - Company list: student who blocked company is not shown
 * - Company list: identity visibility follows canSeeIdentity
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('@/server/services/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  buildEmployerStudentPayload: vi.fn().mockReturnValue({}),
}))

vi.mock('@/server/services/notify', () => ({
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/server/lib/alert', () => ({ alert: vi.fn() }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createJob } from '../factories'
import { clearSettingsCache } from '@/server/services/settings'
import {
  sendInvitation,
  acceptInvitation,
  declineInvitation,
  listCompanyInvitations,
  getMonthlyInvitationUsage,
} from '@/server/services/invitations'
import { runExpireInvitations } from '@/server/jobs/expire-invitations'
import {
  NotFoundError,
  ForbiddenError,
  InvitationQuotaError,
  CompletenessLowError,
} from '@/server/errors'

setupTestDb()

async function seedSettings(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    'invitations.freeMonthlyQuota': 3,
    'invitations.expireDays': 14,
    'talentPool.minCompleteness': 60,
  }
  const all = { ...defaults, ...overrides }
  for (const [key, value] of Object.entries(all)) {
    await testDb.systemSetting.upsert({
      where: { key },
      create: { key, value: value as Parameters<typeof testDb.systemSetting.create>[0]['data']['value'] },
      update: { value: value as Parameters<typeof testDb.systemSetting.create>[0]['data']['value'] },
    })
  }
  clearSettingsCache()
}

/** Make a student visible in the talent pool for the given company. */
async function makeStudentVisible(profileId: string) {
  await testDb.studentProfile.update({
    where: { id: profileId },
    data: { visibility: 'PUBLIC', completeness: 80, schoolVerifiedAt: new Date() },
  })
}

/** Create a verified employer and published job. */
async function createVerifiedEmployerWithJob() {
  const emp = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: emp.companyId },
    data: { verificationStatus: 'VERIFIED' },
  })
  const job = await createJob(testDb, emp.companyId, emp.userId, { status: 'PUBLISHED' })
  return { ...emp, jobId: job.id }
}

describe('sendInvitation', () => {
  it('sends an invitation successfully', async () => {
    await seedSettings()
    const { userId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)

    const result = await sendInvitation(
      { userId, companyId },
      { studentId: student.profileId, jobId, message: 'Hello!' },
    )
    expect(result.invitationId).toBeTypeOf('string')
    expect(result.alreadyExists).toBe(false)

    const inv = await testDb.invitation.findUnique({ where: { id: result.invitationId } })
    expect(inv?.status).toBe('SENT')
    expect(inv?.message).toBe('Hello!')
  })

  it('quota exceeded rejects the invitation', async () => {
    await seedSettings({ 'invitations.freeMonthlyQuota': 2 })
    const { userId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const s1 = await createStudent(testDb)
    const s2 = await createStudent(testDb)
    const s3 = await createStudent(testDb)
    await makeStudentVisible(s1.profileId)
    await makeStudentVisible(s2.profileId)
    await makeStudentVisible(s3.profileId)

    // Need a second job for each since job+student must be unique within SENT
    const job2 = await createJob(testDb, companyId, userId, { status: 'PUBLISHED' })

    await sendInvitation({ userId, companyId }, { studentId: s1.profileId, jobId })
    await sendInvitation({ userId, companyId }, { studentId: s2.profileId, jobId })

    await expect(
      sendInvitation({ userId, companyId }, { studentId: s3.profileId, jobId: job2.id }),
    ).rejects.toBeInstanceOf(InvitationQuotaError)
  })

  it('quota counts only current KL month (last-month invitation does not count)', async () => {
    await seedSettings({ 'invitations.freeMonthlyQuota': 1 })
    const { userId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const s1 = await createStudent(testDb)
    const s2 = await createStudent(testDb)
    await makeStudentVisible(s1.profileId)
    await makeStudentVisible(s2.profileId)

    // Manually insert an invitation dated last month
    const lastMonthDate = new Date()
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1)
    await testDb.invitation.create({
      data: {
        companyId,
        jobId,
        studentId: s1.profileId,
        sentById: userId,
        status: 'SENT',
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        createdAt: lastMonthDate,
      },
    })

    // Should succeed because last month's invitation doesn't count toward this month's quota
    const result = await sendInvitation({ userId, companyId }, { studentId: s2.profileId, jobId })
    expect(result.alreadyExists).toBe(false)
    expect(result.invitationId).toBeTypeOf('string')
  })

  it('concurrent sends do not exceed quota', async () => {
    await seedSettings({ 'invitations.freeMonthlyQuota': 2 })
    const { userId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const students = await Promise.all(
      Array.from({ length: 3 }, () => createStudent(testDb)),
    )
    const jobs = await Promise.all([
      Promise.resolve(jobId),
      createJob(testDb, companyId, userId, { status: 'PUBLISHED' }).then((j) => j.id),
      createJob(testDb, companyId, userId, { status: 'PUBLISHED' }).then((j) => j.id),
    ])
    for (const s of students) await makeStudentVisible(s.profileId)

    const results = await Promise.allSettled(
      students.map((s, i) =>
        sendInvitation({ userId, companyId }, { studentId: s.profileId, jobId: jobs[i]! }),
      ),
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled')
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(succeeded).toHaveLength(2)
    expect(failed).toHaveLength(1)
    expect(failed[0]!.reason).toBeInstanceOf(InvitationQuotaError)
  })

  it('invisible student (blocked) cannot be invited', async () => {
    await seedSettings()
    const { userId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)

    // Student blocks the company
    await testDb.blockedCompany.create({
      data: { studentId: student.profileId, companyId },
    })

    await expect(
      sendInvitation({ userId, companyId }, { studentId: student.profileId, jobId }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('duplicate SENT invitation returns alreadyExists=true', async () => {
    await seedSettings()
    const { userId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)

    const r1 = await sendInvitation({ userId, companyId }, { studentId: student.profileId, jobId })
    const r2 = await sendInvitation({ userId, companyId }, { studentId: student.profileId, jobId })

    expect(r2.alreadyExists).toBe(true)
    expect(r2.invitationId).toBe(r1.invitationId)
  })
})

describe('acceptInvitation', () => {
  it('accept creates application and links applicationId', async () => {
    await seedSettings()
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)

    const { invitationId } = await sendInvitation(
      { userId: empUserId, companyId },
      { studentId: student.profileId, jobId },
    )

    const result = await acceptInvitation({ userId: student.userId }, { invitationId })
    expect(result.applicationId).toBeTypeOf('string')

    const inv = await testDb.invitation.findUnique({ where: { id: invitationId } })
    expect(inv?.status).toBe('ACCEPTED')
    expect(inv?.applicationId).toBe(result.applicationId)
    expect(inv?.respondedAt).not.toBeNull()

    const app = await testDb.application.findUnique({ where: { id: result.applicationId } })
    expect(app?.studentId).toBe(student.profileId)
    expect(app?.jobId).toBe(jobId)
    expect(app?.status).toBe('APPLIED')
  })

  it('expired invitation (expiresAt < now) is rejected', async () => {
    await seedSettings()
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)

    // Create invitation with past expiresAt
    const pastExpiry = new Date(Date.now() - 1000)
    const inv = await testDb.invitation.create({
      data: {
        companyId,
        jobId,
        studentId: student.profileId,
        sentById: empUserId,
        status: 'SENT',
        expiresAt: pastExpiry,
      },
    })

    await expect(
      acceptInvitation({ userId: student.userId }, { invitationId: inv.id }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('student cannot accept another student\'s invitation', async () => {
    await seedSettings()
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const s1 = await createStudent(testDb)
    const s2 = await createStudent(testDb)
    await makeStudentVisible(s1.profileId)

    const { invitationId } = await sendInvitation(
      { userId: empUserId, companyId },
      { studentId: s1.profileId, jobId },
    )

    await expect(
      acceptInvitation({ userId: s2.userId }, { invitationId }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('same invitation cannot be accepted twice', async () => {
    await seedSettings()
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)

    const { invitationId } = await sendInvitation(
      { userId: empUserId, companyId },
      { studentId: student.profileId, jobId },
    )

    await acceptInvitation({ userId: student.userId }, { invitationId })
    await expect(
      acceptInvitation({ userId: student.userId }, { invitationId }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
  // Accepting goes through applyToJob, so it must apply the same guards as the job page.
  it('accept is rejected when the job was closed after the invitation was sent', async () => {
    await seedSettings()
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)
    const { invitationId } = await sendInvitation(
      { userId: empUserId, companyId },
      { studentId: student.profileId, jobId },
    )
    await testDb.job.update({ where: { id: jobId }, data: { status: 'CLOSED' } })

    await expect(
      acceptInvitation({ userId: student.userId }, { invitationId }),
    ).rejects.toBeInstanceOf(NotFoundError)
    const inv = await testDb.invitation.findUnique({ where: { id: invitationId } })
    expect(inv?.status).toBe('SENT')
    expect(inv?.applicationId).toBeNull()
    expect(await testDb.application.count({ where: { jobId, studentId: student.profileId } })).toBe(0)
  })

  it('accept is rejected when profile completeness is below apply.minCompleteness', async () => {
    await seedSettings({ 'apply.minCompleteness': 60 })
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)
    const { invitationId } = await sendInvitation(
      { userId: empUserId, companyId },
      { studentId: student.profileId, jobId },
    )
    await testDb.studentProfile.update({ where: { id: student.profileId }, data: { completeness: 30 } })

    await expect(
      acceptInvitation({ userId: student.userId }, { invitationId }),
    ).rejects.toBeInstanceOf(CompletenessLowError)
    const inv = await testDb.invitation.findUnique({ where: { id: invitationId } })
    expect(inv?.status).toBe('SENT')
    expect(await testDb.application.count({ where: { jobId, studentId: student.profileId } })).toBe(0)
  })
})

describe('declineInvitation', () => {
  it('decline sets status to DECLINED', async () => {
    await seedSettings()
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)

    const { invitationId } = await sendInvitation(
      { userId: empUserId, companyId },
      { studentId: student.profileId, jobId },
    )

    await declineInvitation({ userId: student.userId }, { invitationId })

    const inv = await testDb.invitation.findUnique({ where: { id: invitationId } })
    expect(inv?.status).toBe('DECLINED')
    expect(inv?.respondedAt).not.toBeNull()
  })
})

describe('runExpireInvitations', () => {
  it('only marks SENT+expired rows as EXPIRED', async () => {
    // Create: 1 expired-SENT, 1 not-expired-SENT, 1 already-ACCEPTED
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const s1 = await createStudent(testDb)
    const s2 = await createStudent(testDb)
    const s3 = await createStudent(testDb)
    await makeStudentVisible(s1.profileId)
    await makeStudentVisible(s2.profileId)
    await makeStudentVisible(s3.profileId)

    const expiredInv = await testDb.invitation.create({
      data: {
        companyId,
        jobId,
        studentId: s1.profileId,
        sentById: empUserId,
        status: 'SENT',
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    const futureInv = await testDb.invitation.create({
      data: {
        companyId,
        jobId,
        studentId: s2.profileId,
        sentById: empUserId,
        status: 'SENT',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })

    const acceptedInv = await testDb.invitation.create({
      data: {
        companyId,
        jobId,
        studentId: s3.profileId,
        sentById: empUserId,
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() - 1000),
        respondedAt: new Date(),
      },
    })

    await runExpireInvitations()

    const expiredRow = await testDb.invitation.findUnique({ where: { id: expiredInv.id } })
    const futureRow = await testDb.invitation.findUnique({ where: { id: futureInv.id } })
    const acceptedRow = await testDb.invitation.findUnique({ where: { id: acceptedInv.id } })

    expect(expiredRow?.status).toBe('EXPIRED')
    expect(futureRow?.status).toBe('SENT')
    expect(acceptedRow?.status).toBe('ACCEPTED')
  })
})

describe('listCompanyInvitations', () => {
  it('student who blocked company is not shown', async () => {
    await seedSettings()
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)

    await sendInvitation({ userId: empUserId, companyId }, { studentId: student.profileId, jobId })

    // Student blocks company after invitation sent
    await testDb.blockedCompany.create({ data: { studentId: student.profileId, companyId } })

    const list = await listCompanyInvitations({ userId: empUserId, companyId })
    // Student is blocked → invisible → filtered out
    expect(list.map((i) => i.student.id)).not.toContain(student.profileId)
  })

  it('identity not shown when no TalentUnlock (canSeeIdentity=false)', async () => {
    await seedSettings()
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)
    // Give student a distinctive name
    await testDb.studentProfile.update({
      where: { id: student.profileId },
      data: { fullName: '张三同学' },
    })

    await sendInvitation({ userId: empUserId, companyId }, { studentId: student.profileId, jobId })

    const list = await listCompanyInvitations({ userId: empUserId, companyId })
    const item = list.find((i) => i.student.id === student.profileId)
    expect(item).toBeDefined()
    // No TalentUnlock → unlocked=false → name is masked
    expect(item!.student.unlocked).toBe(false)
    expect(item!.student.name).not.toBe('张三同学')
  })

  it('identity shown when TalentUnlock exists (canSeeIdentity=true)', async () => {
    await seedSettings()
    const { userId: empUserId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)
    await testDb.studentProfile.update({
      where: { id: student.profileId },
      data: { fullName: '李四同学' },
    })

    await sendInvitation({ userId: empUserId, companyId }, { studentId: student.profileId, jobId })

    // Create a TalentUnlock so identity is visible
    await testDb.talentUnlock.create({
      data: { companyId, studentId: student.profileId, unlockedById: empUserId, source: 'CREDIT', creditsSpent: 1 },
    })

    const list = await listCompanyInvitations({ userId: empUserId, companyId })
    const item = list.find((i) => i.student.id === student.profileId)
    expect(item).toBeDefined()
    expect(item!.student.unlocked).toBe(true)
    expect(item!.student.name).toBe('李四同学')
  })
})

describe('getMonthlyInvitationUsage', () => {
  it('returns correct usage and quota', async () => {
    await seedSettings({ 'invitations.freeMonthlyQuota': 5 })
    const { userId, companyId, jobId } = await createVerifiedEmployerWithJob()
    const student = await createStudent(testDb)
    await makeStudentVisible(student.profileId)

    await sendInvitation({ userId, companyId }, { studentId: student.profileId, jobId })

    const usage = await getMonthlyInvitationUsage(companyId)
    expect(usage.used).toBe(1)
    expect(usage.quota).toBe(5)
  })
})
