/**
 * Integration tests for the job review service (M5-T02).
 * Tests approve/reject flows, auditLog, notification, and approvedJobCount increment.
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

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import {
  listPendingJobs,
  approveJob,
  rejectJob,
} from '@/server/services/review-jobs'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
import type { UserCtx } from '@/server/authz'

setupTestDb()

async function makeAdminCtx(): Promise<UserCtx> {
  const user = await testDb.user.create({
    data: {
      name: 'Admin User',
      email: `admin-review-jobs-${Date.now()}@example.test`,
      emailVerified: true,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  })
  return { userId: user.id }
}

async function makeStudentCtx(): Promise<UserCtx> {
  const user = await testDb.user.create({
    data: {
      name: 'Student User',
      email: `student-review-jobs-${Date.now()}@example.test`,
      emailVerified: true,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  })
  return { userId: user.id }
}

async function makePendingJob(companyId: string, createdById: string) {
  return testDb.job.create({
    data: {
      companyId,
      createdById,
      title: 'Test Intern',
      type: 'INTERNSHIP',
      description: 'Test description',
      status: 'PENDING_REVIEW',
      workMode: 'ONSITE',
    },
  })
}

// ---------------------------------------------------------------------------
// listPendingJobs
// ---------------------------------------------------------------------------

describe('listPendingJobs', () => {
  it('admin can list pending jobs', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, userId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    await makePendingJob(companyId, userId)

    const jobs = await listPendingJobs(adminCtx)
    expect(jobs.length).toBeGreaterThan(0)
    expect(jobs.every(j => j.status === 'PENDING_REVIEW')).toBe(true)
  })

  it('non-admin is rejected', async () => {
    const studentCtx = await makeStudentCtx()
    await expect(listPendingJobs(studentCtx)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// approveJob
// ---------------------------------------------------------------------------

describe('approveJob', () => {
  it('approves a PENDING_REVIEW job → PUBLISHED, increments approvedJobCount', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, userId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', approvedJobCount: 5 },
    })
    const job = await makePendingJob(companyId, userId)

    await approveJob(adminCtx, { jobId: job.id })

    const updated = await testDb.job.findUnique({ where: { id: job.id } })
    expect(updated?.status).toBe('PUBLISHED')
    expect(updated?.publishedAt).not.toBeNull()

    const company = await testDb.company.findUnique({ where: { id: companyId } })
    expect(company?.approvedJobCount).toBe(6)
  })

  it('writes an AuditLog with action job.review', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, userId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePendingJob(companyId, userId)

    await approveJob(adminCtx, { jobId: job.id })

    const audit = await testDb.auditLog.findFirst({
      where: { action: 'job.review', targetId: job.id },
    })
    expect(audit).not.toBeNull()
    expect((audit?.metadata as Record<string, unknown>)?.decision).toBe('approved')
  })

  it('creates a notification for the job creator', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, userId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePendingJob(companyId, userId)

    await approveJob(adminCtx, { jobId: job.id })

    const notif = await testDb.notification.findFirst({
      where: { userId, type: 'job.approved' },
    })
    expect(notif).not.toBeNull()
  })

  it('rejects non-admin', async () => {
    const studentCtx = await makeStudentCtx()
    const { companyId, userId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePendingJob(companyId, userId)

    await expect(approveJob(studentCtx, { jobId: job.id })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('throws NotFoundError for unknown jobId', async () => {
    const adminCtx = await makeAdminCtx()
    await expect(approveJob(adminCtx, { jobId: 'nonexistent' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ValidationError when job is not PENDING_REVIEW', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, userId } = await createEmployer(testDb)
    const job = await testDb.job.create({
      data: {
        companyId,
        createdById: userId,
        title: 'Published Job',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
        publishedAt: new Date(),
      },
    })
    await expect(approveJob(adminCtx, { jobId: job.id })).rejects.toBeInstanceOf(ValidationError)
  })

  it('reaching autoPublishAfter threshold causes next job to auto-publish on submission', async () => {
    // This is the acceptance criterion: "达到阈值后，新职位自动发布"
    // approveJob increments approvedJobCount; when it reaches autoPublishAfter,
    // resolveSubmitStatus in jobs.ts returns PUBLISHED for new submissions.
    const adminCtx = await makeAdminCtx()
    const { companyId, userId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', approvedJobCount: 999 },
    })
    // Set threshold to 1000 (matches default seed value)
    await testDb.systemSetting.upsert({
      where: { key: 'jobs.autoPublishAfter' },
      update: { value: 1000 },
      create: { key: 'jobs.autoPublishAfter', value: 1000 },
    })
    const job = await makePendingJob(companyId, userId)

    // Approve brings approvedJobCount from 999 to 1000
    await approveJob(adminCtx, { jobId: job.id })

    const company = await testDb.company.findUnique({ where: { id: companyId } })
    expect(company?.approvedJobCount).toBe(1000)

    // Now new submissions should auto-publish
    const { createJob } = await import('@/server/services/jobs')
    const newJob = await createJob(
      { userId, companyId, role: 'OWNER' },
      {
        title: 'Auto Published',
        type: 'INTERNSHIP',
        description: 'Should auto-publish',
        workMode: 'ONSITE',
        salaryVisible: true,
        languages: [],
        skills: [],
        acceptsStudentPass: false,
        sponsorsWorkPass: false,
        submit: true,
      },
    )
    expect(newJob.status).toBe('PUBLISHED')
  })
})

// ---------------------------------------------------------------------------
// rejectJob
// ---------------------------------------------------------------------------

describe('rejectJob', () => {
  it('rejects a PENDING_REVIEW job → REJECTED with reviewNote', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, userId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePendingJob(companyId, userId)

    await rejectJob(adminCtx, { jobId: job.id, reviewNote: 'Content violates policy' })

    const updated = await testDb.job.findUnique({ where: { id: job.id } })
    expect(updated?.status).toBe('REJECTED')
    expect(updated?.reviewNote).toBe('Content violates policy')
  })

  it('writes an AuditLog with action job.review', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, userId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePendingJob(companyId, userId)

    await rejectJob(adminCtx, { jobId: job.id, reviewNote: 'Insufficient info' })

    const audit = await testDb.auditLog.findFirst({
      where: { action: 'job.review', targetId: job.id },
    })
    expect(audit).not.toBeNull()
    expect((audit?.metadata as Record<string, unknown>)?.decision).toBe('rejected')
  })

  it('creates a notification for the job creator', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, userId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await makePendingJob(companyId, userId)

    await rejectJob(adminCtx, { jobId: job.id, reviewNote: 'Policy violation' })

    const notif = await testDb.notification.findFirst({
      where: { userId, type: 'job.rejected' },
    })
    expect(notif).not.toBeNull()
  })

  it('rejects non-admin', async () => {
    const studentCtx = await makeStudentCtx()
    const { companyId, userId } = await createEmployer(testDb)
    const job = await makePendingJob(companyId, userId)

    await expect(
      rejectJob(studentCtx, { jobId: job.id, reviewNote: 'reason' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('throws NotFoundError for unknown jobId', async () => {
    const adminCtx = await makeAdminCtx()
    await expect(
      rejectJob(adminCtx, { jobId: 'nonexistent', reviewNote: 'reason' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ValidationError when job is not PENDING_REVIEW', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, userId } = await createEmployer(testDb)
    const job = await testDb.job.create({
      data: {
        companyId,
        createdById: userId,
        title: 'Draft Job',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'DRAFT',
        workMode: 'ONSITE',
      },
    })
    await expect(
      rejectJob(adminCtx, { jobId: job.id, reviewNote: 'reason' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})
