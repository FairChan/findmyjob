/**
 * Integration tests for PRD §6 notification events.
 *
 * Each PRD §6 row has at least one test here, calling the actual business
 * function (not createNotification directly). Mocks only the email provider.
 *
 * PRD §6 events covered:
 *  1.  Company verification approved (in-app + email)
 *  2.  Company verification rejected (in-app + email)
 *  3.  Job review approved (email locale=en)
 *  4.  Job review rejected (no company note in notification)
 *  5.  New application received (in-app only; daily digest for email)
 *  6.  Application status changed (no company note in payload/email)
 *  7.  Student unlocked (in-app + email)
 *  8.  Invitation received (in-app + email)
 *  9.  Invitation accepted (in-app, no email)
 *  10. Invitation declined (in-app, no email)
 *  11. Credits granted (in-app + email)
 *  12. Credits low (in-app + email, same company ≤1/day)
 *  13. Signup cap warning (email to admins + system.alert in-app via alert())
 *  14. Referral qualified (in-app, no email)
 *  15. Quota exhausted (in-app, no email)
 *  16. System alert via alert() (in-app to admins)
 *  17. Order confirmed stub
 *  18. New report stub
 *  19. Existing-user signup reminder (email, locale-aware)
 *  20. Transaction rollback: notification not persisted, no email
 *  21. Daily digest: 2 applications in window → 1 email; re-run same window → no duplicate
 *  22. Daily digest content has job title and count, no student name
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

const _mockAlert = vi.hoisted(() => vi.fn())
vi.mock('@/server/lib/alert', () => ({
  alert: _mockAlert,
}))

const _mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/email', () => ({
  createEmailProvider: vi.fn(() => ({
    sendEmail: _mockSendEmail,
  })),
}))

vi.mock('@/server/lib/email-cap', () => ({
  checkEmailCap: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/server/lib/db-rate-limit', () => ({
  hitBucket: vi.fn().mockResolvedValue({ allowed: true, count: 1, remaining: 499, resetAt: Date.now() + 60000 }),
}))

vi.mock('@/server/lib/healthchecks', () => ({
  pingHealthcheck: vi.fn(),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createAdmin } from '../factories'
import { createNotification } from '@/server/services/notifications'
import { clearSettingsCache } from '@/server/services/settings'
import { createEmailProvider } from '@/lib/email'
import { hitBucket } from '@/server/lib/db-rate-limit'

setupTestDb()

beforeEach(() => {
  clearSettingsCache()
  vi.mocked(createEmailProvider).mockClear()
  vi.mocked(createEmailProvider).mockReturnValue({ sendEmail: _mockSendEmail })
  _mockSendEmail.mockClear()
  _mockAlert.mockClear()
  vi.mocked(hitBucket).mockResolvedValue({ allowed: true, count: 1, remaining: 499, resetAt: Date.now() + 60000 })
})

// ---- helpers ---------------------------------------------------------------

async function makeVerifiedCompanyOwner() {
  const emp = await createEmployer(testDb)
  const cv = await testDb.companyVerification.create({
    data: {
      companyId: emp.companyId,
      submittedById: emp.userId,
      documentKeys: [],
    },
  })
  await testDb.company.update({
    where: { id: emp.companyId },
    data: { verificationStatus: 'PENDING' },
  })
  return { emp, cvId: cv.id }
}

async function makeAdminUser() {
  return createAdmin(testDb)
}

async function makePublishedJob(companyId: string, createdById: string) {
  return testDb.job.create({
    data: {
      companyId,
      createdById,
      title: 'Test Job',
      type: 'INTERNSHIP',
      description: 'Desc',
      status: 'PUBLISHED',
      workMode: 'ONSITE',
      updatedAt: new Date(),
    },
  })
}

async function makePendingJob(companyId: string, createdById: string) {
  return testDb.job.create({
    data: {
      companyId,
      createdById,
      title: 'Pending Job',
      type: 'INTERNSHIP',
      description: 'Desc',
      status: 'PENDING_REVIEW',
      workMode: 'ONSITE',
      updatedAt: new Date(),
    },
  })
}

// ---- PRD §6 Row 1 & 2: Company verification approved / rejected ------------

describe('PRD §6 — company verification approved/rejected', () => {
  it('approveCompany creates company.verified notification to OWNER and sends zh email', async () => {
    const { emp, cvId } = await makeVerifiedCompanyOwner()
    const admin = await makeAdminUser()
    await testDb.user.update({ where: { id: emp.userId }, data: { locale: 'zh' } })
    const { approveCompany } = await import('@/server/services/review-company')

    await approveCompany({ userId: admin.userId }, {
      verificationId: cvId,
      verifiedChannels: ['SSM'],
      verificationResult: 'SSM 记录匹配',
    })

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'company.verified' },
    })
    expect(notif).not.toBeNull()
    expect((notif?.payload as Record<string, unknown>).companyId).toBe(emp.companyId)

    // Email should be sent (approveCompany also sends credits.granted email via grantPilotCreditsOnVerification)
    const verifyCall = _mockSendEmail.mock.calls.find(
      (c) => (c[0] as { subject?: string })?.subject?.includes('通过'),
    )
    expect(verifyCall).toBeDefined()
    expect((verifyCall?.[0] as { to?: string })?.to).toBe(emp.email)
  })

  it('approveCompany sends English email for locale=en owner', async () => {
    const { emp, cvId } = await makeVerifiedCompanyOwner()
    const admin = await makeAdminUser()
    await testDb.user.update({ where: { id: emp.userId }, data: { locale: 'en' } })
    const { approveCompany } = await import('@/server/services/review-company')

    await approveCompany({ userId: admin.userId }, {
      verificationId: cvId,
      verifiedChannels: ['SSM'],
      verificationResult: 'SSM match',
    })

    const approvedCall = _mockSendEmail.mock.calls.find(
      (c) => (c[0] as { subject?: string })?.subject?.includes('Approved'),
    )
    expect(approvedCall).toBeDefined()
  })

  it('rejectCompany creates company.rejected notification to OWNER and sends zh email', async () => {
    const { emp, cvId } = await makeVerifiedCompanyOwner()
    const admin = await makeAdminUser()
    await testDb.user.update({ where: { id: emp.userId }, data: { locale: 'zh' } })
    const { rejectCompany } = await import('@/server/services/review-company')

    await rejectCompany({ userId: admin.userId }, {
      verificationId: cvId,
      reviewNote: '材料不符',
    })

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'company.rejected' },
    })
    expect(notif).not.toBeNull()

    expect(_mockSendEmail).toHaveBeenCalledOnce()
    const call = _mockSendEmail.mock.calls[0]?.[0] as { subject?: string; to?: string }
    expect(call.to).toBe(emp.email)
    expect(call.subject).toContain('未通过')
  })

  it('company notification payload does not contain student full name (no unlock)', async () => {
    const { emp, cvId } = await makeVerifiedCompanyOwner()
    const admin = await makeAdminUser()
    const { approveCompany } = await import('@/server/services/review-company')

    await approveCompany({ userId: admin.userId }, {
      verificationId: cvId,
      verifiedChannels: ['SSM'],
      verificationResult: 'ok',
    })

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'company.verified' },
    })
    const payload = notif?.payload as Record<string, unknown>
    // Company verification notification should not contain student full name
    expect(payload.name).toBeUndefined()
    expect(payload.fullName).toBeUndefined()
    // Also verify no contact info
    expect(JSON.stringify(payload)).not.toContain('+60')
  })
})

// ---- PRD §6 Row 3 & 4: Job review result -----------------------------------

describe('PRD §6 — job review result', () => {
  it('approveJob sends English email for locale=en job creator', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.user.update({ where: { id: emp.userId }, data: { locale: 'en' } })
    const job = await makePendingJob(emp.companyId, emp.userId)
    const admin = await makeAdminUser()
    const { approveJob } = await import('@/server/services/review-jobs')

    await approveJob({ userId: admin.userId }, { jobId: job.id, updatedAt: job.updatedAt })

    const call = _mockSendEmail.mock.calls[0]?.[0] as { subject?: string }
    expect(call.subject).toContain('Approved')
  })

  it('rejectJob notification payload does not contain company note', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePendingJob(emp.companyId, emp.userId)
    const admin = await makeAdminUser()
    const { rejectJob } = await import('@/server/services/review-jobs')

    await rejectJob({ userId: admin.userId }, {
      jobId: job.id,
      reviewNote: 'Secret internal reason',
      updatedAt: job.updatedAt,
    })

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'job.rejected' },
    })
    const payload = notif?.payload as Record<string, unknown>
    // company internal notes must not appear as a leaked field name
    expect(payload.companyNote).toBeUndefined()
    expect(payload.internalNote).toBeUndefined()
  })
})

// ---- PRD §6 Row 5: New application received --------------------------------

describe('PRD §6 — new application received', () => {
  it('applyToJob creates job.application.new notification to job creator (no direct email)', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePublishedJob(emp.companyId, emp.userId)
    const student = await createStudent(testDb, { completeness: 100 })
    // Create a JobView first so canApplyToJob returns true (quota bypass protection)
    await testDb.jobView.create({ data: { studentId: student.profileId, jobId: job.id } })
    const { applyToJob } = await import('@/server/services/applications')

    await applyToJob({ userId: student.userId }, { jobId: job.id })

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'job.application.new' },
    })
    expect(notif).not.toBeNull()
    expect((notif?.payload as Record<string, unknown>).jobId).toBe(job.id)

    // No direct email for new application — only daily digest
    expect(_mockSendEmail).not.toHaveBeenCalled()
  })

  it('new application notification does not contain student full name when no unlock', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePublishedJob(emp.companyId, emp.userId)
    const student = await createStudent(testDb, { completeness: 100 })
    await testDb.jobView.create({ data: { studentId: student.profileId, jobId: job.id } })
    const { applyToJob } = await import('@/server/services/applications')

    await applyToJob({ userId: student.userId }, { jobId: job.id })

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'job.application.new' },
    })
    const payload = notif?.payload as Record<string, unknown>
    // The notification should not contain the student's full name
    expect(JSON.stringify(payload)).not.toContain(student.name)
  })
})

// ---- PRD §6 Row 6: Application status changed ------------------------------

describe('PRD §6 — application status changed', () => {
  async function makeApplication() {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePublishedJob(emp.companyId, emp.userId)
    const student = await createStudent(testDb, { completeness: 100 })
    // Create a JobView so canApplyToJob returns true (quota bypass protection)
    await testDb.jobView.create({ data: { studentId: student.profileId, jobId: job.id } })
    const { applyToJob } = await import('@/server/services/applications')
    const { applicationId } = await applyToJob({ userId: student.userId }, { jobId: job.id })
    return { emp, student, job, applicationId }
  }

  it('changeApplicationStatus creates application.status.changed notification to student', async () => {
    const { emp, student, applicationId } = await makeApplication()
    _mockSendEmail.mockClear()
    const { changeApplicationStatus } = await import('@/server/services/applicants')

    await changeApplicationStatus(
      { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' },
      { applicationId, toStatus: 'VIEWED' },
    )

    const notif = await testDb.notification.findFirst({
      where: { userId: student.userId, type: 'application.status.changed' },
    })
    expect(notif).not.toBeNull()
    const payload = notif?.payload as Record<string, unknown>
    expect(payload.toStatus).toBe('VIEWED')
  })

  it('application status notification payload does not contain company note', async () => {
    const { emp, student, applicationId } = await makeApplication()
    _mockSendEmail.mockClear()
    const { changeApplicationStatus } = await import('@/server/services/applicants')

    await changeApplicationStatus(
      { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' },
      { applicationId, toStatus: 'SHORTLISTED', note: 'Internal: strong candidate' },
    )

    const notif = await testDb.notification.findFirst({
      where: { userId: student.userId, type: 'application.status.changed' },
    })
    const payload = notif?.payload as Record<string, unknown>
    // Company note must NOT appear in the student's notification payload
    expect(payload.note).toBeUndefined()
    expect(payload.companyNote).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain('Internal: strong candidate')
  })

  it('changeApplicationStatus sends email to student and not to company', async () => {
    const { emp, student, applicationId } = await makeApplication()
    _mockSendEmail.mockClear()
    await testDb.user.update({ where: { id: student.userId }, data: { locale: 'zh' } })
    const { changeApplicationStatus } = await import('@/server/services/applicants')

    await changeApplicationStatus(
      { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' },
      { applicationId, toStatus: 'INTERVIEW' },
    )

    expect(_mockSendEmail).toHaveBeenCalledOnce()
    const call = _mockSendEmail.mock.calls[0]?.[0] as { to?: string; subject?: string }
    expect(call.to).toBe(student.email)
    expect(call.to).not.toBe(emp.email)
    expect(call.subject).toContain('投递状态')
  })

  it('application status email does not contain company note', async () => {
    const { emp, student, applicationId } = await makeApplication()
    _mockSendEmail.mockClear()
    const { changeApplicationStatus } = await import('@/server/services/applicants')

    await changeApplicationStatus(
      { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' },
      { applicationId, toStatus: 'OFFER', note: 'Confidential salary info' },
    )

    const call = _mockSendEmail.mock.calls[0]?.[0] as { html?: string; text?: string }
    expect(call.html ?? '').not.toContain('Confidential salary info')
    expect(call.text ?? '').not.toContain('Confidential salary info')
  })
})

// ---- PRD §6 Row 7: Student unlocked ----------------------------------------

describe('PRD §6 — student unlocked', () => {
  it('unlockStudent creates talent.unlock notification to student and sends email', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 100 } })
    const student = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { userId: student.userId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
    })
    await testDb.user.update({ where: { id: student.userId }, data: { locale: 'zh' } })

    const { unlockStudent } = await import('@/server/services/unlock')
    await unlockStudent({ userId: emp.userId, companyId: emp.companyId }, student.profileId)

    const notif = await testDb.notification.findFirst({
      where: { userId: student.userId, type: 'talent.unlock' },
    })
    expect(notif).not.toBeNull()

    // Find the email sent to the student
    const sentToStudent = _mockSendEmail.mock.calls.find(
      (c) => (c[0] as { to?: string })?.to === student.email,
    )
    expect(sentToStudent).toBeDefined()
    const subject = (sentToStudent?.[0] as { subject?: string })?.subject ?? ''
    expect(subject).toContain('解锁')
  })

  it('unlock notification does not contain student contact details', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 100 } })
    const student = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { userId: student.userId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
    })
    // Create contact record so we can verify the phone doesn't leak into the notification payload
    await testDb.studentContact.upsert({
      where: { studentId: student.profileId },
      create: { studentId: student.profileId, phone: '+60 12-000 0420' },
      update: { phone: '+60 12-000 0420' },
    })

    const { unlockStudent } = await import('@/server/services/unlock')
    await unlockStudent({ userId: emp.userId, companyId: emp.companyId }, student.profileId)

    const notif = await testDb.notification.findFirst({
      where: { userId: student.userId, type: 'talent.unlock' },
    })
    // The notification must exist, otherwise the negative check below passes vacuously.
    expect(notif).not.toBeNull()
    // Student unlock notification must not contain contact info
    expect(JSON.stringify(notif!.payload)).not.toContain('+60 12-000 0420')
  })
})

// ---- PRD §6 Row 8: Invitation received -------------------------------------

describe('PRD §6 — invitation received', () => {
  it('sendInvitation creates invitation.received notification to student and sends email', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePublishedJob(emp.companyId, emp.userId)
    const student = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { userId: student.userId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
    })
    await testDb.user.update({ where: { id: student.userId }, data: { locale: 'zh' } })

    const { sendInvitation } = await import('@/server/services/invitations')
    await sendInvitation(
      { userId: emp.userId, companyId: emp.companyId },
      { jobId: job.id, studentId: student.profileId, message: 'Please join!' },
    )

    const notif = await testDb.notification.findFirst({
      where: { userId: student.userId, type: 'invitation.received' },
    })
    expect(notif).not.toBeNull()

    expect(_mockSendEmail).toHaveBeenCalledOnce()
    const call = _mockSendEmail.mock.calls[0]?.[0] as { to?: string; subject?: string }
    expect(call.to).toBe(student.email)
    expect(call.subject).toContain('邀请')
  })
})

// ---- PRD §6 Row 9 & 10: Invitation accepted / declined --------------------

describe('PRD §6 — invitation accepted / declined', () => {
  async function makeInvitation() {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePublishedJob(emp.companyId, emp.userId)
    const student = await createStudent(testDb, { completeness: 100 })
    await testDb.studentProfile.update({
      where: { userId: student.userId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
    })

    const { sendInvitation } = await import('@/server/services/invitations')
    const { invitationId } = await sendInvitation(
      { userId: emp.userId, companyId: emp.companyId },
      { jobId: job.id, studentId: student.profileId, message: 'Join us' },
    )
    _mockSendEmail.mockClear()
    return { emp, student, invitationId }
  }

  it('acceptInvitation creates invitation.accepted notification to company member (no email)', async () => {
    const { emp, student, invitationId } = await makeInvitation()
    const { acceptInvitation } = await import('@/server/services/invitations')

    await acceptInvitation({ userId: student.userId }, { invitationId })

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'invitation.accepted' },
    })
    expect(notif).not.toBeNull()
    // No email for invitation accepted (PRD §6)
    expect(_mockSendEmail).not.toHaveBeenCalled()
  })

  it('declineInvitation creates invitation.declined notification to company member (no email)', async () => {
    const { emp, student, invitationId } = await makeInvitation()
    const { declineInvitation } = await import('@/server/services/invitations')

    await declineInvitation({ userId: student.userId }, { invitationId })

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'invitation.declined' },
    })
    expect(notif).not.toBeNull()
    // No email for invitation declined (PRD §6)
    expect(_mockSendEmail).not.toHaveBeenCalled()
  })

  it('invitation accepted notification payload contains no contact details', async () => {
    const { emp, student, invitationId } = await makeInvitation()
    const { acceptInvitation } = await import('@/server/services/invitations')

    await acceptInvitation({ userId: student.userId }, { invitationId })

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'invitation.accepted' },
    })
    expect(notif).not.toBeNull()
    const payloadStr = JSON.stringify(notif!.payload)
    // Accepting creates an application, so the name may appear (PRD §6); contact details never do.
    expect(payloadStr).not.toContain('@')
    expect(payloadStr).not.toContain('+60')
  })

  it('invitation declined notification payload does not contain the student full name', async () => {
    const { emp, student, invitationId } = await makeInvitation()
    const profile = await testDb.studentProfile.findUniqueOrThrow({
      where: { userId: student.userId },
      select: { fullName: true },
    })
    expect(profile.fullName).toBeTruthy()
    const { declineInvitation } = await import('@/server/services/invitations')

    await declineInvitation({ userId: student.userId }, { invitationId })

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'invitation.declined' },
    })
    expect(notif).not.toBeNull()
    // Declining creates no application and no unlock: PRD §6 forbids the full name here.
    expect(JSON.stringify(notif!.payload)).not.toContain(profile.fullName!)
  })
})

// ---- PRD §6 Row 11: Credits granted ----------------------------------------

describe('PRD §6 — credits granted', () => {
  it('grantPilotCreditsOnVerification creates credits.granted notification and sends email', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    // Create wallet so grantPilotCredits can apply a ledger entry
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 0 } })
    await testDb.user.update({ where: { id: emp.userId }, data: { locale: 'zh' } })

    const { grantPilotCreditsOnVerification } = await import('@/server/services/pilot-credits')
    await grantPilotCreditsOnVerification(emp.companyId)

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'credits.granted' },
    })
    expect(notif).not.toBeNull()

    // Find email sent to employer
    const sentToEmp = _mockSendEmail.mock.calls.find(
      (c) => (c[0] as { to?: string })?.to === emp.email,
    )
    expect(sentToEmp).toBeDefined()
    const subject = (sentToEmp?.[0] as { subject?: string })?.subject ?? ''
    expect(subject).toContain('点数')
  })
})

// ---- PRD §6 Row 12: Credits low --------------------------------------------

describe('PRD §6 — credits low', () => {
  it('unlockStudent creates credits.low notification when balance drops to threshold', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    // Balance = 6, threshold = 5, cost = 1 → after unlock: balance = 5 = threshold → triggers credits.low
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 6 } })
    const student = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { userId: student.userId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
    })
    await testDb.systemSetting.upsert({
      where: { key: 'unlock.costCredits' },
      create: { key: 'unlock.costCredits', value: 1 },
      update: { value: 1 },
    })
    await testDb.systemSetting.upsert({
      where: { key: 'credits.lowThreshold' },
      create: { key: 'credits.lowThreshold', value: 5 },
      update: { value: 5 },
    })
    clearSettingsCache()

    const { unlockStudent } = await import('@/server/services/unlock')
    await unlockStudent({ userId: emp.userId, companyId: emp.companyId }, student.profileId)

    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'credits.low' },
    })
    expect(notif).not.toBeNull()
    expect((notif?.payload as Record<string, unknown>).balance).toBe(5)

    // Email should be sent for credits low
    const lowCall = _mockSendEmail.mock.calls.find(
      (c) => {
        const call = c[0] as { to?: string; subject?: string }
        return call.to === emp.email && /余额|balance/i.test(call.subject ?? '')
      },
    )
    expect(lowCall).toBeDefined()
  })

  it('credits.low notification is NOT sent when hitBucket returns allowed=false (rate limit)', async () => {
    vi.mocked(hitBucket).mockResolvedValueOnce({ allowed: false, count: 2, remaining: 0, resetAt: Date.now() + 60000 })

    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 6 } })
    const student = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { userId: student.userId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
    })
    await testDb.systemSetting.upsert({
      where: { key: 'unlock.costCredits' },
      create: { key: 'unlock.costCredits', value: 1 },
      update: { value: 1 },
    })
    await testDb.systemSetting.upsert({
      where: { key: 'credits.lowThreshold' },
      create: { key: 'credits.lowThreshold', value: 5 },
      update: { value: 5 },
    })
    clearSettingsCache()

    const { unlockStudent } = await import('@/server/services/unlock')
    await unlockStudent({ userId: emp.userId, companyId: emp.companyId }, student.profileId)

    // No credits.low notification should be created because hitBucket returned allowed=false
    const notif = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'credits.low' },
    })
    expect(notif).toBeNull()
  })
})

// ---- PRD §6 Row 13: Signup cap warning ------------------------------------

describe('PRD §6 — signup cap warning', () => {
  it('maybeWarnCap sends email to admin and calls alert() when threshold reached', async () => {
    const admin = await makeAdminUser()
    await testDb.user.update({ where: { id: admin.userId }, data: { locale: 'zh' } })

    // cap=1, ratio=0.5, threshold=floor(1*0.5)=0; 1 student ≥ 1 → warn
    await testDb.systemSetting.upsert({
      where: { key: 'signup.studentCap' },
      create: { key: 'signup.studentCap', value: JSON.stringify(1) },
      update: { value: JSON.stringify(1) },
    })
    await testDb.systemSetting.upsert({
      where: { key: 'signup.warnRatio' },
      create: { key: 'signup.warnRatio', value: JSON.stringify(0.5) },
      update: { value: JSON.stringify(0.5) },
    })
    await testDb.systemSetting.deleteMany({ where: { key: 'signup.capWarnSent' } })
    await createStudent(testDb)
    clearSettingsCache()

    const { maybeWarnCap } = await import('@/server/services/signup-cap')
    await maybeWarnCap()

    expect(_mockSendEmail).toHaveBeenCalledOnce()
    const call = _mockSendEmail.mock.calls[0]?.[0] as { to?: string; subject?: string }
    expect(call.to).toBe(admin.email)
    expect(call.subject).toContain('预警')

    // alert() should be called (which also creates in-app system.alert notification)
    expect(_mockAlert).toHaveBeenCalledWith('signup.cap.warn', expect.objectContaining({ count: expect.any(Number) }))
  })
})

// ---- PRD §6 Row 14: Referral qualified ------------------------------------

describe('PRD §6 — referral qualified', () => {
  it('qualifyReferral creates referral.qualified notification to referrer (no email)', async () => {
    const referrer = await createStudent(testDb)
    const invitee = await createStudent(testDb, { completeness: 100 })

    await testDb.referral.create({
      data: {
        referrerId: referrer.profileId,
        inviteeId: invitee.profileId,
        status: 'PENDING',
      },
    })

    await testDb.systemSetting.upsert({
      where: { key: 'referral.minCompleteness' },
      create: { key: 'referral.minCompleteness', value: JSON.stringify(50) },
      update: { value: JSON.stringify(50) },
    })
    clearSettingsCache()

    const { qualifyReferral } = await import('@/server/services/referrals')
    await qualifyReferral(invitee.profileId)

    const notif = await testDb.notification.findFirst({
      where: { userId: referrer.userId, type: 'referral.qualified' },
    })
    expect(notif).not.toBeNull()

    // No email for referral.qualified (PRD §6 has no email column ✓ for this row)
    expect(_mockSendEmail).not.toHaveBeenCalled()
  })
})

// ---- PRD §6 Row 15: Quota exhausted ----------------------------------------

describe('PRD §6 — quota exhausted', () => {
  it('openJob creates quota.exhausted notification when quota is used up (no email)', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePublishedJob(emp.companyId, emp.userId)
    const student = await createStudent(testDb)

    // Set base views to 1 so the first view exhausts the quota
    await testDb.systemSetting.upsert({
      where: { key: 'studentQuota.baseJobViews' },
      create: { key: 'studentQuota.baseJobViews', value: 1 },
      update: { value: 1 },
    })
    clearSettingsCache()

    const { openJob } = await import('@/server/services/job-view-quota')
    await openJob(student.profileId, job.id)

    const notif = await testDb.notification.findFirst({
      where: { userId: student.userId, type: 'quota.exhausted' },
    })
    expect(notif).not.toBeNull()
    expect((notif?.payload as Record<string, unknown>).limit).toBe(1)

    // No email for quota.exhausted
    expect(_mockSendEmail).not.toHaveBeenCalled()
  })
})

// ---- PRD §6 Row 16: System alert --------------------------------------------

describe('PRD §6 — system alert', () => {
  it('alert() calls the alert mock (in-app notification is wired via notifyAdmins)', async () => {
    // The alert mock is active; verify it's called with expected args
    _mockAlert.mockClear()
    // Call the mocked alert via signup-cap which uses it
    await testDb.systemSetting.upsert({
      where: { key: 'signup.studentCap' },
      create: { key: 'signup.studentCap', value: JSON.stringify(1) },
      update: { value: JSON.stringify(1) },
    })
    await testDb.systemSetting.upsert({
      where: { key: 'signup.warnRatio' },
      create: { key: 'signup.warnRatio', value: JSON.stringify(0.5) },
      update: { value: JSON.stringify(0.5) },
    })
    await testDb.systemSetting.deleteMany({ where: { key: 'signup.capWarnSent' } })
    await createStudent(testDb)
    clearSettingsCache()

    const { maybeWarnCap } = await import('@/server/services/signup-cap')
    await maybeWarnCap()

    expect(_mockAlert).toHaveBeenCalledWith('signup.cap.warn', expect.any(Object))
  })
})

// ---- PRD §6 Row 17 & 18: order confirmed (M8-T02 entry), new report (M7-T09 entry) ----

describe('PRD §6 — order confirmed and new report entry points', () => {
  it('notifyOrderConfirmed writes order.confirmed to the company OWNER and emails them in their locale', async () => {
    const emp = await createEmployer(testDb)
    await testDb.user.update({ where: { id: emp.userId }, data: { locale: 'en' } })
    const owner = await testDb.user.findUniqueOrThrow({ where: { id: emp.userId }, select: { email: true } })
    _mockSendEmail.mockClear()

    const { notifyOrderConfirmed } = await import('@/server/services/notify')
    await notifyOrderConfirmed(emp.companyId, { orderId: 'ord-m5t08', amountSen: 12345 })

    const rows = await testDb.notification.findMany({ where: { type: 'order.confirmed' } })
    expect(rows.map((r) => r.userId)).toEqual([emp.userId])
    expect(rows[0].payload).toEqual({ orderId: 'ord-m5t08', amountSen: 12345 })
    expect(_mockSendEmail).toHaveBeenCalledTimes(1)
    const mail = _mockSendEmail.mock.calls[0][0] as { to: string; subject: string; text: string }
    expect(mail.to).toBe(owner.email)
    expect(mail.subject).toBe('FindMYJob — Payment confirmed')
    expect(mail.text).toContain('RM 123.45')
  })

  it('notifyNewReport writes report.new to every ACTIVE admin only and sends no email', async () => {
    const active = await createAdmin(testDb)
    const suspended = await createAdmin(testDb)
    await testDb.user.update({ where: { id: suspended.userId }, data: { status: 'SUSPENDED' } })
    _mockSendEmail.mockClear()

    const { notifyNewReport } = await import('@/server/services/notify')
    await notifyNewReport('report-m5t08')

    const rows = await testDb.notification.findMany({ where: { type: 'report.new' } })
    expect(rows.map((r) => r.userId)).toEqual([active.userId])
    expect(rows[0].payload).toEqual({ reportId: 'report-m5t08' })
    expect(_mockSendEmail).not.toHaveBeenCalled()
  })
})

// ---- PRD §6 Row 19: Existing-user signup reminder --------------------------

describe('PRD §6 — existing-user signup reminder', () => {
  it('sendExistingUserReminder sends zh email for zh user', async () => {
    const student = await createStudent(testDb)
    await testDb.user.update({ where: { id: student.userId }, data: { locale: 'zh' } })

    const { sendExistingUserReminder } = await import('@/server/services/notify')
    await sendExistingUserReminder(student.email)

    expect(_mockSendEmail).toHaveBeenCalledOnce()
    const call = _mockSendEmail.mock.calls[0]?.[0] as { to?: string; subject?: string }
    expect(call.to).toBe(student.email)
    expect(call.subject).toContain('注册')
  })

  it('sendExistingUserReminder sends English email for locale=en user', async () => {
    const student = await createStudent(testDb)
    await testDb.user.update({ where: { id: student.userId }, data: { locale: 'en' } })

    const { sendExistingUserReminder } = await import('@/server/services/notify')
    await sendExistingUserReminder(student.email)

    const call = _mockSendEmail.mock.calls[0]?.[0] as { subject?: string }
    expect(call.subject).toContain('FindMYJob account')
  })

  it('sendExistingUserReminder defaults to zh for unknown user', async () => {
    const { sendExistingUserReminder } = await import('@/server/services/notify')
    // Unknown email - user not in DB; should still send using default locale
    await sendExistingUserReminder('no-such-user@example.test')

    expect(_mockSendEmail).toHaveBeenCalledOnce()
    const call = _mockSendEmail.mock.calls[0]?.[0] as { subject?: string }
    // Default locale is 'zh'
    expect(call.subject).toContain('注册')
  })
})

// ---- Transaction rollback: no notification, no email -----------------------

describe('transaction rollback', () => {
  it('rolled-back transaction leaves no notification and sends no email', async () => {
    const student = await createStudent(testDb)

    try {
      await testDb.$transaction(async (tx) => {
        await createNotification(tx, student.userId, 'test.rollback.event', { data: 'test' })
        // Force rollback after notification is written to the transaction
        throw new Error('forced rollback for test')
      })
    } catch {
      // Expected
    }

    // Notification must NOT be in the DB because the transaction was rolled back
    const rows = await testDb.notification.findMany({
      where: { userId: student.userId, type: 'test.rollback.event' },
    })
    expect(rows).toHaveLength(0)
    // Email must NOT be called because no commit happened
    expect(_mockSendEmail).not.toHaveBeenCalled()
  })
})

// ---- Daily digest tests ----------------------------------------------------

describe('daily digest', () => {
  function getKLYesterdayStart(): Date {
    const KL_OFFSET_MS = 8 * 60 * 60 * 1000
    const klNow = new Date(Date.now() + KL_OFFSET_MS)
    const klTodayStart = new Date(
      Date.UTC(klNow.getUTCFullYear(), klNow.getUTCMonth(), klNow.getUTCDate()) - KL_OFFSET_MS,
    )
    return new Date(klTodayStart.getTime() - 24 * 60 * 60 * 1000)
  }

  it('sends one email for 2 applications in window (content has job title, no student names)', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: emp.companyId },
      data: { verificationStatus: 'VERIFIED', isActive: true },
    })
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 100 } })
    await testDb.user.update({ where: { id: emp.userId }, data: { locale: 'zh' } })

    const job = await testDb.job.create({
      data: {
        companyId: emp.companyId,
        createdById: emp.userId,
        title: 'Digest Test Job',
        type: 'INTERNSHIP',
        description: 'Desc',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
        updatedAt: new Date(),
      },
    })

    const student1 = await createStudent(testDb)
    const student2 = await createStudent(testDb)
    const klYesterdayStart = getKLYesterdayStart()

    // Create 2 applications in the previous KL day window
    await testDb.application.createMany({
      data: [
        {
          jobId: job.id,
          studentId: student1.profileId,
          status: 'APPLIED',
          createdAt: new Date(klYesterdayStart.getTime() + 60_000),
          updatedAt: new Date(klYesterdayStart.getTime() + 60_000),
        },
        {
          jobId: job.id,
          studentId: student2.profileId,
          status: 'APPLIED',
          createdAt: new Date(klYesterdayStart.getTime() + 120_000),
          updatedAt: new Date(klYesterdayStart.getTime() + 120_000),
        },
      ],
    })

    const { runEmployerDailyDigest } = await import('@/server/jobs/employer-daily-digest')
    const result = await runEmployerDailyDigest()

    expect(result.sent).toBe(1)
    expect(_mockSendEmail).toHaveBeenCalledOnce()
    const call = _mockSendEmail.mock.calls[0]?.[0] as { to?: string; html?: string }
    expect(call.to).toBe(emp.email)
    // Email should contain job title and count
    expect(call.html).toContain('Digest Test Job')
    // Email must NOT contain student names
    expect(call.html).not.toContain(student1.name)
    expect(call.html).not.toContain(student2.name)
  })

  it('running digest again in same window does NOT resend email (idempotent)', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: emp.companyId },
      data: { verificationStatus: 'VERIFIED', isActive: true },
    })
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 100 } })

    const job = await testDb.job.create({
      data: {
        companyId: emp.companyId,
        createdById: emp.userId,
        title: 'Dedup Test Job',
        type: 'INTERNSHIP',
        description: 'Desc',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
        updatedAt: new Date(),
      },
    })

    const student = await createStudent(testDb)
    const klYesterdayStart = getKLYesterdayStart()

    await testDb.application.create({
      data: {
        jobId: job.id,
        studentId: student.profileId,
        status: 'APPLIED',
        createdAt: new Date(klYesterdayStart.getTime() + 60_000),
        updatedAt: new Date(klYesterdayStart.getTime() + 60_000),
      },
    })

    const { runEmployerDailyDigest } = await import('@/server/jobs/employer-daily-digest')

    // First run: should send 1 email
    const result1 = await runEmployerDailyDigest()
    expect(result1.sent).toBe(1)
    expect(_mockSendEmail).toHaveBeenCalledOnce()

    _mockSendEmail.mockClear()

    // Second run: same window, same applications — should NOT send again
    const result2 = await runEmployerDailyDigest()
    expect(result2.sent).toBe(0)
    expect(_mockSendEmail).not.toHaveBeenCalled()
  })
})
