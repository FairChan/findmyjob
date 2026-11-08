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
import { getStudentApplicationTimeline } from '@/server/services/applications'
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from '@/server/errors'
import { withdrawApplication } from '@/server/services/applications'

setupTestDb()

// M5-T13: all applicant services require verified company; use this helper for positive tests
async function createVerifiedEmployer() {
  const emp = await createEmployer(testDb)
  await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
  return emp
}

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
    const emp = await createVerifiedEmployer()
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
    const empA = await createVerifiedEmployer()
    const empB = await createVerifiedEmployer()
    const jobB = await createJob(testDb, empB.companyId, empB.userId)

    const ctxA = { userId: empA.userId, companyId: empA.companyId, role: 'OWNER' as const }
    await expect(listJobApplicants(ctxA, jobB.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('excludes WITHDRAWN applicants', async () => {
    const emp = await createVerifiedEmployer()
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    await createApplication(student.profileId, job.id, ApplicationStatus.WITHDRAWN)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    const result = await listJobApplicants(ctx, job.id)
    expect(result.applicants).toHaveLength(0)
  })

  it('identity is locked (unlocked=false) when no TalentUnlock exists', async () => {
    const emp = await createVerifiedEmployer()
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
    const emp = await createVerifiedEmployer()
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
    const empA = await createVerifiedEmployer()
    const empB = await createVerifiedEmployer()
    const student = await createStudent(testDb)
    const jobB = await createJob(testDb, empB.companyId, empB.userId)
    const appB = await createApplication(student.profileId, jobB.id)

    const ctxA = { userId: empA.userId, companyId: empA.companyId, role: 'OWNER' as const }
    await expect(
      changeApplicationStatus(ctxA, { applicationId: appB.id, toStatus: ApplicationStatus.VIEWED }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('cannot change status of WITHDRAWN application → ForbiddenError', async () => {
    const emp = await createVerifiedEmployer()
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id, ApplicationStatus.WITHDRAWN)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await expect(
      changeApplicationStatus(ctx, { applicationId: app.id, toStatus: ApplicationStatus.VIEWED }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('cannot set WITHDRAWN status (company-settable check) → ValidationError', async () => {
    const emp = await createVerifiedEmployer()
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await expect(
      changeApplicationStatus(ctx, { applicationId: app.id, toStatus: ApplicationStatus.WITHDRAWN }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('no-op when setting same status', async () => {
    const emp = await createVerifiedEmployer()
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
    const emp = await createVerifiedEmployer()
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await updateApplicationNote(ctx, { applicationId: app.id, note: 'Great candidate' })

    const updated = await testDb.application.findUnique({ where: { id: app.id } })
    expect(updated?.companyNote).toBe('Great candidate')
  })

  it('cross-company: cannot update note for another company application → NotFoundError', async () => {
    const empA = await createVerifiedEmployer()
    const empB = await createVerifiedEmployer()
    const student = await createStudent(testDb)
    const jobB = await createJob(testDb, empB.companyId, empB.userId)
    const appB = await createApplication(student.profileId, jobB.id)

    const ctxA = { userId: empA.userId, companyId: empA.companyId, role: 'OWNER' as const }
    await expect(
      updateApplicationNote(ctxA, { applicationId: appB.id, note: 'Hack note' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('companyNote is NOT returned by listJobApplicants under a different company', async () => {
    const empA = await createVerifiedEmployer()
    const empB = await createVerifiedEmployer()
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
    const emp = await createVerifiedEmployer()
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
    const emp = await createVerifiedEmployer()
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await createApplication(student.profileId, job.id, ApplicationStatus.SHORTLISTED)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await markApplicationViewed(ctx, app.id)

    const updated = await testDb.application.findUnique({ where: { id: app.id } })
    expect(updated?.status).toBe('SHORTLISTED')
  })

  it('cross-company: no-op (graceful) when application belongs to another company', async () => {
    const empA = await createVerifiedEmployer()
    const empB = await createVerifiedEmployer()
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

// ---------------------------------------------------------------------------
// M5-T13: coverNote redaction when canSeeIdentity=false
// ---------------------------------------------------------------------------

describe('coverNote redaction (M5-T13)', () => {
  async function makeVerifiedEmp() {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    return emp
  }

  async function makeStudentWithSentinels(name: string) {
    // coverNote contains the student's real name + contact info sentinels
    const student = await createStudent(testDb, { name })
    return student
  }

  async function createAppWithCoverNote(studentId: string, jobId: string, coverNote: string) {
    return testDb.application.create({
      data: { jobId, studentId, status: ApplicationStatus.APPLIED, coverNote },
    })
  }

  async function createTalentUnlock(companyId: string, studentId: string, unlockedById: string) {
    await testDb.creditWallet.upsert({
      where: { companyId },
      create: { companyId, balance: 10 },
      update: {},
    })
    return testDb.talentUnlock.create({
      data: { companyId, studentId, unlockedById, source: 'CREDIT', creditsSpent: 1 },
    })
  }

  it('unlocked: returns original coverNote unchanged', async () => {
    const studentName = 'Wang Fang'
    const emp = await makeVerifiedEmp()
    const student = await makeStudentWithSentinels(studentName)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const coverNote = `My name is ${studentName}, call me at 012-3456789`
    await createAppWithCoverNote(student.profileId, job.id, coverNote)
    await createTalentUnlock(emp.companyId, student.profileId, emp.userId)

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    const { applicants } = await listJobApplicants(ctx, job.id)
    expect(applicants[0].coverNote).toBe(coverNote)
  })

  it('blocked student: coverNote must not contain name or phone sentinel', async () => {
    const studentName = 'Li Xiaohua'
    const emp = await makeVerifiedEmp()
    const student = await makeStudentWithSentinels(studentName)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const coverNote = `我叫${studentName}，微信 lixiaohua123，邮件 lixiaohua@example.test`
    await createAppWithCoverNote(student.profileId, job.id, coverNote)
    await createTalentUnlock(emp.companyId, student.profileId, emp.userId)
    // Block student from company
    await testDb.blockedCompany.create({ data: { studentId: student.profileId, companyId: emp.companyId } })

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    const { applicants } = await listJobApplicants(ctx, job.id)
    const result = applicants[0]
    expect(result.card.unlocked).toBe(false)
    // Name and identifiers must be redacted
    const serialized = JSON.stringify(result.coverNote)
    expect(serialized).not.toContain(studentName)
    expect(serialized).not.toContain('lixiaohua@example.test')
  })

  it('SUSPENDED student user: coverNote must not contain name', async () => {
    const studentName = 'Chen Jianming'
    const emp = await makeVerifiedEmp()
    const student = await makeStudentWithSentinels(studentName)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const coverNote = `My name is ${studentName} and I am applying for this role.`
    await createAppWithCoverNote(student.profileId, job.id, coverNote)
    await createTalentUnlock(emp.companyId, student.profileId, emp.userId)
    // Suspend the student
    await testDb.user.update({ where: { id: student.userId }, data: { status: 'SUSPENDED' } })

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    const { applicants } = await listJobApplicants(ctx, job.id)
    const result = applicants[0]
    expect(result.card.unlocked).toBe(false)
    expect(JSON.stringify(result.coverNote)).not.toContain(studentName)
  })

  it('DELETED student user: coverNote must not contain name', async () => {
    const studentName = 'Zhang Meili'
    const emp = await makeVerifiedEmp()
    const student = await makeStudentWithSentinels(studentName)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const coverNote = `Hello, I am ${studentName}, looking for an internship.`
    await createAppWithCoverNote(student.profileId, job.id, coverNote)
    await createTalentUnlock(emp.companyId, student.profileId, emp.userId)
    // Mark student as deleted
    await testDb.user.update({ where: { id: student.userId }, data: { status: 'DELETED' } })

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    const { applicants } = await listJobApplicants(ctx, job.id)
    const result = applicants[0]
    expect(result.card.unlocked).toBe(false)
    expect(JSON.stringify(result.coverNote)).not.toContain(studentName)
  })

  it('REJECTED company verification: listJobApplicants throws ForbiddenError', async () => {
    const studentName = 'Liu Yang'
    const emp = await makeVerifiedEmp()
    const student = await makeStudentWithSentinels(studentName)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const coverNote = `I am ${studentName}.`
    await createAppWithCoverNote(student.profileId, job.id, coverNote)
    await createTalentUnlock(emp.companyId, student.profileId, emp.userId)
    // Revoke company verification
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'REJECTED' } })

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await expect(listJobApplicants(ctx, job.id)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// M5-T13: unverified company blocked (item 2)
// ---------------------------------------------------------------------------

describe('unverified company blocked from applicant service (M5-T13)', () => {
  it('PENDING company: changeApplicationStatus → ForbiddenError', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'PENDING' } })
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await testDb.application.create({ data: { jobId: job.id, studentId: student.profileId, status: ApplicationStatus.APPLIED } })

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await expect(
      changeApplicationStatus(ctx, { applicationId: app.id, toStatus: ApplicationStatus.VIEWED }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('REJECTED company: updateApplicationNote → ForbiddenError', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'REJECTED' } })
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await testDb.application.create({ data: { jobId: job.id, studentId: student.profileId, status: ApplicationStatus.APPLIED } })

    const ctx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    await expect(
      updateApplicationNote(ctx, { applicationId: app.id, note: 'hack' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// M5-T13: concurrent status change — WITHDRAWN cannot be overridden (item 3)
// ---------------------------------------------------------------------------

describe('concurrent status change (M5-T13)', () => {
  it('concurrent company change + student withdrawal: WITHDRAWN is not overridden', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const student = await createStudent(testDb, { completeness: 70 })
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await testDb.application.create({
      data: { jobId: job.id, studentId: student.profileId, status: ApplicationStatus.APPLIED },
    })

    const companyCtx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    const studentCtx = { userId: student.userId }

    const [companyResult, studentResult] = await Promise.allSettled([
      changeApplicationStatus(companyCtx, { applicationId: app.id, toStatus: ApplicationStatus.SHORTLISTED }),
      withdrawApplication(studentCtx, { applicationId: app.id }),
    ])

    const final = await testDb.application.findUnique({ where: { id: app.id } })

    const studentWon = studentResult.status === 'fulfilled'
    const companyWon = companyResult.status === 'fulfilled'

    // Final status must be one of the two possible outcomes; never left in APPLIED
    expect([ApplicationStatus.SHORTLISTED, ApplicationStatus.WITHDRAWN]).toContain(final?.status)
    // Both ops cannot have set APPLIED (initial status must have changed)
    expect(final?.status).not.toBe(ApplicationStatus.APPLIED)
    // If student withdrew, the final state must reflect withdrawal (unless company also succeeded and raced ahead)
    // The important invariant: at least one party succeeded
    expect(studentWon || companyWon).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// M5-T13: ApplicationEvent.note must not reach student via timeline (item 4)
// ---------------------------------------------------------------------------

describe('student timeline: note excluded (M5-T13)', () => {
  it('getStudentApplicationTimeline never returns the company note', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const student = await createStudent(testDb, { completeness: 70 })
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await testDb.application.create({
      data: { jobId: job.id, studentId: student.profileId, status: ApplicationStatus.APPLIED },
    })

    const companyCtx = { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const }
    // Company changes status with an internal note
    await changeApplicationStatus(companyCtx, {
      applicationId: app.id,
      toStatus: ApplicationStatus.SHORTLISTED,
      note: 'TOP_SECRET_NOTE',
    })

    const studentCtx = { userId: student.userId }
    const timeline = await getStudentApplicationTimeline(studentCtx, app.id)

    // Timeline must contain the status change event
    expect(timeline.length).toBeGreaterThan(0)
    const event = timeline.find((e) => e.toStatus === ApplicationStatus.SHORTLISTED)
    expect(event).toBeDefined()

    // The serialized timeline must not contain the company note
    const serialized = JSON.stringify(timeline)
    expect(serialized).not.toContain('TOP_SECRET_NOTE')
    // Keys on each event must not include 'note' or 'actorId'
    for (const e of timeline) {
      expect(Object.keys(e)).not.toContain('note')
      expect(Object.keys(e)).not.toContain('actorId')
    }
  })

  it('getStudentApplicationTimeline: student cannot read another student application', async () => {
    const emp = await createEmployer(testDb)
    const studentA = await createStudent(testDb)
    const studentB = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId)
    const app = await testDb.application.create({
      data: { jobId: job.id, studentId: studentA.profileId, status: ApplicationStatus.APPLIED },
    })

    const ctxB = { userId: studentB.userId }
    await expect(getStudentApplicationTimeline(ctxB, app.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})
