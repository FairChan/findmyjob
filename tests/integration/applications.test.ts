/**
 * Integration tests for applications service (M5-T04).
 *
 * Tests:
 * - Duplicate application rejected with DuplicateApplicationError
 * - Insufficient completeness rejected with CompletenessLowError
 * - After application, TalentUnlock(source=APPLICATION) exists (company sees contact without spending credits)
 * - Withdraw changes status to WITHDRAWN
 * - Concurrent duplicate apply → only one created
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
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/server/lib/alert', () => ({
  alert: vi.fn(),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createJob } from '../factories'
import { clearSettingsCache } from '@/server/services/settings'
import {
  applyToJob,
  withdrawApplication,
  getMyApplicationForJob,
} from '@/server/services/applications'
import { canApplyToJob } from '@/server/services/job-view-quota'
import { getContactForCompany } from '@/server/services/contact-access'
import { encryptField } from '@/server/lib/crypto'
import {
  DuplicateApplicationError,
  CompletenessLowError,
  NotFoundError,
  ForbiddenError,
} from '@/server/errors'
import { ApplicationStatus } from '@prisma/client'

setupTestDb()

/** Pre-seed a JobView so canApplyToJob returns true (required by M5-T12 quota bypass fix). */
async function addJobView(studentId: string, jobId: string) {
  await testDb.jobView.upsert({
    where: { studentId_jobId: { studentId, jobId } },
    create: { studentId, jobId },
    update: {},
  })
}

async function seedApplySettings(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    'apply.minCompleteness': 60,
  }
  const settings = { ...defaults, ...overrides }
  for (const [key, value] of Object.entries(settings)) {
    await testDb.systemSetting.upsert({
      where: { key },
      create: { key, value: value as Parameters<typeof testDb.systemSetting.create>[0]['data']['value'] },
      update: { value: value as Parameters<typeof testDb.systemSetting.create>[0]['data']['value'] },
    })
  }
  clearSettingsCache()
}

async function createStudentWithCompleteness(completeness: number) {
  const { userId, profileId } = await createStudent(testDb, { completeness })
  return { userId, profileId }
}

async function createPublishedJob(companyId: string, userId: string) {
  return createJob(testDb, companyId, userId, { status: 'PUBLISHED' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('applyToJob', () => {
  it('succeeds with sufficient completeness', async () => {
    await seedApplySettings()
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    await addJobView(profileId, job.id)

    const result = await applyToJob({ userId }, { jobId: job.id })

    expect(result.applicationId).toBeTruthy()
    const app = await testDb.application.findUnique({ where: { id: result.applicationId } })
    expect(app).not.toBeNull()
    expect(app?.status).toBe(ApplicationStatus.APPLIED)
    expect(app?.studentId).toBe(profileId)

    // ApplicationEvent created
    const events = await testDb.applicationEvent.findMany({ where: { applicationId: result.applicationId } })
    expect(events).toHaveLength(1)
    expect(events[0].toStatus).toBe(ApplicationStatus.APPLIED)
  })

  it('creates TalentUnlock(source=APPLICATION, creditsSpent=0) in same transaction', async () => {
    await seedApplySettings()
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    await addJobView(profileId, job.id)

    await applyToJob({ userId }, { jobId: job.id })

    const unlock = await testDb.talentUnlock.findUnique({
      where: { companyId_studentId: { companyId: emp.companyId, studentId: profileId } },
    })
    expect(unlock).not.toBeNull()
    expect(unlock?.source).toBe('APPLICATION')
    expect(unlock?.creditsSpent).toBe(0)
  })

  it('company can read contact via getContactForCompany after application without spending credits', async () => {
    await seedApplySettings()
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: emp.companyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    const job = await createPublishedJob(emp.companyId, emp.userId)
    await addJobView(profileId, job.id)

    // Write encrypted contact info for the student
    const encPhone = encryptField('+60123456789', `StudentContact.phone:${profileId}`)
    await testDb.studentContact.create({ data: { studentId: profileId, phone: encPhone } })

    // No TalentUnlock exists yet, no credits spent
    const walletBefore = await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } })
    expect(walletBefore).toBeNull()

    // Student applies
    await applyToJob({ userId }, { jobId: job.id })

    // Company can now read contact
    const contact = await getContactForCompany(emp.companyId, profileId)
    expect(contact.phone).toBe('+60123456789')

    // Still no wallet / credits spent
    const walletAfter = await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } })
    expect(walletAfter).toBeNull()
  })

  it('throws CompletenessLowError when completeness is below minimum', async () => {
    await seedApplySettings({ 'apply.minCompleteness': 60 })
    const { userId } = await createStudentWithCompleteness(50)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)

    await expect(
      applyToJob({ userId }, { jobId: job.id }),
    ).rejects.toBeInstanceOf(CompletenessLowError)
  })

  it('throws DuplicateApplicationError on duplicate apply', async () => {
    await seedApplySettings()
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    await addJobView(profileId, job.id)

    await applyToJob({ userId }, { jobId: job.id })

    await expect(
      applyToJob({ userId }, { jobId: job.id }),
    ).rejects.toBeInstanceOf(DuplicateApplicationError)

    // Only one application exists
    const count = await testDb.application.count({ where: { studentId: profileId, jobId: job.id } })
    expect(count).toBe(1)
  })

  it('throws NotFoundError for non-existent or unpublished job', async () => {
    await seedApplySettings()
    const { userId } = await createStudentWithCompleteness(70)

    await expect(
      applyToJob({ userId }, { jobId: 'cnotexistcuid0000000000' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError for a DRAFT job', async () => {
    await seedApplySettings()
    const { userId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    await testDb.job.update({ where: { id: job.id }, data: { status: 'DRAFT' } })

    await expect(
      applyToJob({ userId }, { jobId: job.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws NotFoundError when resume does not belong to this student', async () => {
    await seedApplySettings()
    const { userId } = await createStudentWithCompleteness(70)
    const { profileId: otherId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)

    // Create a resume belonging to the OTHER student
    const otherResume = await testDb.resumeFile.create({
      data: {
        studentId: otherId,
        storageKey: `resumes/${otherId}/cv.pdf`,
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
      },
    })

    await expect(
      applyToJob({ userId }, { jobId: job.id, resumeId: otherResume.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ForbiddenError when student has no profile', async () => {
    // userId without a StudentProfile
    const user = await testDb.user.create({
      data: { name: 'No Profile', email: 'noprofile-apply@example.test', emailVerified: true, role: 'STUDENT', status: 'ACTIVE' },
    })
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)

    await expect(
      applyToJob({ userId: user.id }, { jobId: job.id }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('concurrent duplicate apply → only one application created', async () => {
    await seedApplySettings()
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    await addJobView(profileId, job.id)

    const results = await Promise.allSettled([
      applyToJob({ userId }, { jobId: job.id }),
      applyToJob({ userId }, { jobId: job.id }),
    ])

    const successes = results.filter((r) => r.status === 'fulfilled')
    const failures = results.filter((r) => r.status === 'rejected')

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect((failures[0] as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateApplicationError)

    const count = await testDb.application.count({ where: { studentId: profileId, jobId: job.id } })
    expect(count).toBe(1)
  })

  it('concurrent apply does not create duplicate TalentUnlock', async () => {
    await seedApplySettings()
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)

    // Create two separate published jobs
    const job1 = await createPublishedJob(emp.companyId, emp.userId)
    const job2 = await createPublishedJob(emp.companyId, emp.userId)
    // Both jobs need a JobView (M5-T12 quota bypass fix)
    await addJobView(profileId, job1.id)
    await addJobView(profileId, job2.id)

    // Apply to both simultaneously (creates TalentUnlock for same company+student)
    await Promise.all([
      applyToJob({ userId }, { jobId: job1.id }),
      applyToJob({ userId }, { jobId: job2.id }),
    ])

    const unlocks = await testDb.talentUnlock.findMany({
      where: { companyId: emp.companyId, studentId: profileId },
    })
    expect(unlocks).toHaveLength(1)
  })

  // --- M5-T12: quota bypass prevention tests ---

  it('quota exhausted, no JobView, no Invitation → NOT_FOUND (quota bypass blocked)', async () => {
    await seedApplySettings({ 'studentQuota.enabled': true, 'studentQuota.baseJobViews': 1 })
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    const otherJob = await createPublishedJob(emp.companyId, emp.userId)

    // Exhaust the 1-view quota by viewing a different job
    await testDb.jobView.create({ data: { studentId: profileId, jobId: otherJob.id } })

    // No JobView for job, no invitation → canApplyToJob returns false
    await expect(
      applyToJob({ userId }, { jobId: job.id }),
    ).rejects.toBeInstanceOf(NotFoundError)

    // No Application created
    const count = await testDb.application.count({ where: { studentId: profileId, jobId: job.id } })
    expect(count).toBe(0)
    // No TalentUnlock created
    const unlocks = await testDb.talentUnlock.findMany({ where: { companyId: emp.companyId, studentId: profileId } })
    expect(unlocks).toHaveLength(0)
  })

  it('has JobView → apply succeeds even when quota would otherwise block', async () => {
    await seedApplySettings({ 'studentQuota.enabled': true, 'studentQuota.baseJobViews': 1 })
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    const otherJob = await createPublishedJob(emp.companyId, emp.userId)

    // Exhaust quota with another job
    await testDb.jobView.create({ data: { studentId: profileId, jobId: otherJob.id } })
    // But student already viewed this specific job
    await addJobView(profileId, job.id)

    const result = await applyToJob({ userId }, { jobId: job.id })
    expect(result.applicationId).toBeTruthy()
  })

  it('has Invitation (no JobView) → apply succeeds', async () => {
    await seedApplySettings({ 'studentQuota.enabled': true, 'studentQuota.baseJobViews': 1 })
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    const otherJob = await createPublishedJob(emp.companyId, emp.userId)

    // Exhaust quota
    await testDb.jobView.create({ data: { studentId: profileId, jobId: otherJob.id } })
    // No JobView for job, but student has an invitation
    await testDb.invitation.create({
      data: {
        jobId: job.id,
        studentId: profileId,
        companyId: emp.companyId,
        sentById: emp.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })

    const result = await applyToJob({ userId }, { jobId: job.id })
    expect(result.applicationId).toBeTruthy()
  })

  it('canApplyToJob: unlimited quota (enabled=false) → true', async () => {
    await seedApplySettings({ 'studentQuota.enabled': false })
    const { profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)

    const result = await canApplyToJob(profileId, job.id)
    expect(result).toBe(true)
  })
})

describe('withdrawApplication', () => {
  it('changes status to WITHDRAWN and creates ApplicationEvent', async () => {
    await seedApplySettings()
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    await addJobView(profileId, job.id)

    const { applicationId } = await applyToJob({ userId }, { jobId: job.id })
    await withdrawApplication({ userId }, { applicationId })

    const app = await testDb.application.findUnique({ where: { id: applicationId } })
    expect(app?.status).toBe(ApplicationStatus.WITHDRAWN)

    const events = await testDb.applicationEvent.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'asc' },
    })
    expect(events).toHaveLength(2)
    expect(events[1].fromStatus).toBe(ApplicationStatus.APPLIED)
    expect(events[1].toStatus).toBe(ApplicationStatus.WITHDRAWN)
  })

  it('throws NotFoundError when applicationId does not belong to this student', async () => {
    await seedApplySettings()
    const { userId: uid1, profileId: pid1 } = await createStudentWithCompleteness(70)
    const { userId: uid2 } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    await addJobView(pid1, job.id)

    const { applicationId } = await applyToJob({ userId: uid1 }, { jobId: job.id })

    // uid2 tries to withdraw uid1's application
    await expect(
      withdrawApplication({ userId: uid2 }, { applicationId }),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Application still APPLIED
    const app = await testDb.application.findUnique({ where: { id: applicationId } })
    expect(app?.status).toBe(ApplicationStatus.APPLIED)
  })

  it('is idempotent: withdrawing twice does not error', async () => {
    await seedApplySettings()
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    await addJobView(profileId, job.id)

    const { applicationId } = await applyToJob({ userId }, { jobId: job.id })
    await withdrawApplication({ userId }, { applicationId })
    // Second call should be a no-op, not throw
    await expect(withdrawApplication({ userId }, { applicationId })).resolves.toBeUndefined()
  })
})

describe('getMyApplicationForJob', () => {
  it('returns null when no application exists', async () => {
    await seedApplySettings()
    const { userId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)

    const result = await getMyApplicationForJob({ userId }, job.id)
    expect(result).toBeNull()
  })

  it('returns application after applying', async () => {
    await seedApplySettings()
    const { userId, profileId } = await createStudentWithCompleteness(70)
    const emp = await createEmployer(testDb)
    const job = await createPublishedJob(emp.companyId, emp.userId)
    await addJobView(profileId, job.id)

    const { applicationId } = await applyToJob({ userId }, { jobId: job.id })
    const result = await getMyApplicationForJob({ userId }, job.id)

    expect(result?.id).toBe(applicationId)
    expect(result?.status).toBe(ApplicationStatus.APPLIED)
  })
})
