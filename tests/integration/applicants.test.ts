/**
 * Integration tests for the applicants service (M5-T05).
 *
 * Covers:
 * - listJobApplicants: company ownership check, identity visibility
 * - changeApplicationStatus: status transitions, event written, auth check
 * - updateApplicationNote: note update, isolation
 * - markApplicationViewed: auto-VIEWED on first open
 * - companyNote isolation: not visible in student-side query
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ApplicationStatus } from '@prisma/client'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('@/lib/storage', () => ({
  deleteAllVersions: vi.fn().mockResolvedValue(undefined),
  getSignedUploadUrl: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
  getObjectBytes: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createJob } from '../factories'
import {
  listJobApplicants,
  changeApplicationStatus,
  updateApplicationNote,
  markApplicationViewed,
} from '@/server/services/applicants'
import { NotFoundError, ValidationError, ForbiddenError } from '@/server/errors'

setupTestDb()

async function seedSetting(key: string, value: unknown) {
  await testDb.systemSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  })
}

async function createApplication(
  studentId: string,
  jobId: string,
  status: ApplicationStatus = ApplicationStatus.APPLIED,
) {
  return testDb.application.create({
    data: { jobId, studentId, status },
  })
}

// ---------------------------------------------------------------------------
// listJobApplicants
// ---------------------------------------------------------------------------

describe('listJobApplicants', () => {
  it('returns applicants for own job', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    await createApplication(student.profileId, job.id)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    const result = await listJobApplicants(ctx, job.id)

    expect(result.jobTitle).toBe(job.title)
    expect(result.applicants).toHaveLength(1)
    expect(result.applicants[0].studentId).toBe(student.profileId)
  })

  it('cross-company: cannot list applicants for another company job → NotFoundError', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    const jobB = await createJob(testDb, empB.companyId, empB.userId)

    const ctxA = { userId: empA.userId, companyId: empA.companyId, role: 'OWNER' as const }
    await expect(listJobApplicants(ctxA, jobB.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('excludes WITHDRAWN applicants', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    await createApplication(student.profileId, job.id, ApplicationStatus.WITHDRAWN)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    const result = await listJobApplicants(ctx, job.id)
    expect(result.applicants).toHaveLength(0)
  })

  it('identity is locked (unlocked=false) when no TalentUnlock exists', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    await createApplication(student.profileId, job.id)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    const { applicants } = await listJobApplicants(ctx, job.id)
    expect(applicants[0].card.unlocked).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// changeApplicationStatus
// ---------------------------------------------------------------------------

describe('changeApplicationStatus', () => {
  it('changes status and writes ApplicationEvent', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await changeApplicationStatus(ctx, { applicationId: app.id, toStatus: ApplicationStatus.SHORTLISTED })

    const updated = await testDb.application.findUnique({ where: { id: app.id } })
    expect(updated?.status).toBe('SHORTLISTED')

    const events = await testDb.applicationEvent.findMany({ where: { applicationId: app.id } })
    const event = events.find((e) => e.toStatus === 'SHORTLISTED')
    expect(event).toBeDefined()
    expect(event?.fromStatus).toBe('APPLIED')
    expect(event?.actorId).toBe(emp.userId)
  })

  it('cross-company: cannot change status for another company application → NotFoundError', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const jobB = await createJob(testDb, empB.companyId, empB.userId)
    const appB = await createApplication(student.profileId, jobB.id)

    const ctxA = { userId: empA.userId, companyId: empA.companyId, role: 'OWNER' as const }
    await expect(
      changeApplicationStatus(ctxA, { applicationId: appB.id, toStatus: ApplicationStatus.VIEWED }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('cannot change status of WITHDRAWN application → ForbiddenError', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id, ApplicationStatus.WITHDRAWN)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await expect(
      changeApplicationStatus(ctx, { applicationId: app.id, toStatus: ApplicationStatus.VIEWED }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('cannot set WITHDRAWN status (company-settable check) → ValidationError', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await expect(
      changeApplicationStatus(ctx, { applicationId: app.id, toStatus: ApplicationStatus.WITHDRAWN }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('no-op when setting same status', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id, ApplicationStatus.SHORTLISTED)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await changeApplicationStatus(ctx, { applicationId: app.id, toStatus: ApplicationStatus.SHORTLISTED })

    const events = await testDb.applicationEvent.findMany({ where: { applicationId: app.id } })
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// updateApplicationNote
// ---------------------------------------------------------------------------

describe('updateApplicationNote', () => {
  it('updates companyNote', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await updateApplicationNote(ctx, { applicationId: app.id, note: 'Great candidate' })

    const updated = await testDb.application.findUnique({ where: { id: app.id } })
    expect(updated?.companyNote).toBe('Great candidate')
  })

  it('cross-company: cannot update note for another company application → NotFoundError', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const jobB = await createJob(testDb, empB.companyId, empB.userId)
    const appB = await createApplication(student.profileId, jobB.id)

    const ctxA = { userId: empA.userId, companyId: empA.companyId, role: 'OWNER' as const }
    await expect(
      updateApplicationNote(ctxA, { applicationId: appB.id, note: 'Hack note' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('companyNote is NOT returned by listJobApplicants under a different company', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const jobA = await createJob(testDb, empA.companyId, empA.userId)
    await createApplication(student.profileId, jobA.id)
    const app = await testDb.application.findFirst({ where: { jobId: jobA.id } })
    // set note directly
    await testDb.application.update({ where: { id: app!.id }, data: { companyNote: 'SECRET' } })

    // Company B lists applicants for some other job — it should not see company A's notes
    const jobB = await createJob(testDb, empB.companyId, empB.userId)
    const ctxB = { userId: empB.userId, companyId: empB.companyId, role: 'OWNER' as const }
    const { applicants } = await listJobApplicants(ctxB, jobB.id)
    // jobB has no applicants; company B never sees company A's applications or notes
    expect(applicants).toHaveLength(0)
    for (const a of applicants) {
      expect(a.companyNote).not.toBe('SECRET')
    }
  })
})

// ---------------------------------------------------------------------------
// markApplicationViewed
// ---------------------------------------------------------------------------

describe('markApplicationViewed', () => {
  it('APPLIED → VIEWED on first open, writes ApplicationEvent', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id, ApplicationStatus.APPLIED)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await markApplicationViewed(ctx, app.id)

    const updated = await testDb.application.findUnique({ where: { id: app.id } })
    expect(updated?.status).toBe('VIEWED')

    const event = await testDb.applicationEvent.findFirst({ where: { applicationId: app.id, toStatus: 'VIEWED' } })
    expect(event).not.toBeNull()
  })

  it('no-op when already past APPLIED (e.g. SHORTLISTED)', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id, ApplicationStatus.SHORTLISTED)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await markApplicationViewed(ctx, app.id)

    const updated = await testDb.application.findUnique({ where: { id: app.id } })
    expect(updated?.status).toBe('SHORTLISTED')
  })

  it('cross-company: no-op (graceful) when application belongs to another company', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const jobB = await createJob(testDb, empB.companyId, empB.userId)
    const appB = await createApplication(student.profileId, jobB.id)

    const ctxA = { userId: empA.userId, companyId: empA.companyId, role: 'OWNER' as const }
    await markApplicationViewed(ctxA, appB.id)

    const unchanged = await testDb.application.findUnique({ where: { id: appB.id } })
    expect(unchanged?.status).toBe('APPLIED')
  })
})

// ---------------------------------------------------------------------------
// companyNote must not appear in any student-side model
// ---------------------------------------------------------------------------

describe('companyNote isolation', () => {
  it('companyNote is not returned by getMyApplicationForJob (student side)', async () => {
    const emp = await createEmployer(testDb)
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await testDb.application.create({
      data: { jobId: job.id, studentId: student.profileId, status: 'APPLIED', companyNote: 'INTERNAL_NOTE' },
    })

    const { getMyApplicationForJob } = await import('@/server/services/applications')
    const result = await getMyApplicationForJob({ userId: student.userId }, job.id)
    expect(result).not.toBeNull()
    // The student-side result only contains id and status — no companyNote key
    const keys = Object.keys(result ?? {})
    expect(keys).not.toContain('companyNote')

    // cleanup
    await testDb.applicationEvent.deleteMany({ where: { applicationId: app.id } })
    await testDb.application.delete({ where: { id: app.id } })
  })
})
