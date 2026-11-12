import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobReportReason } from '@prisma/client'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))

const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/email', () => ({ createEmailProvider: vi.fn(() => ({ sendEmail })) }))

const warn = vi.hoisted(() => vi.fn())
vi.mock('@/server/lib/logger', () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createJob, createStudent } from '../factories'
import { createReport, resolveReport } from '@/server/services/reports'
import { clearSettingsCache } from '@/server/services/settings'
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from '@/server/errors'

setupTestDb()
beforeEach(() => { clearSettingsCache(); vi.clearAllMocks() })
afterEach(() => vi.useRealTimers())

async function reportFixture() {
  const student = await createStudent(testDb)
  const employer = await createEmployer(testDb)
  const job = await createJob(testDb, employer.companyId, employer.userId)
  return { student, employer, job }
}

async function seedReports(reporterId: string, jobId: string, count: number, createdAt = new Date()) {
  await testDb.jobReport.createMany({
    data: Array.from({ length: count }, () => ({
      reporterId, jobId, reason: 'OTHER' as const, createdAt,
    })),
  })
}

describe('createReport authorization and input', () => {
  it.each(['STUDENT', 'EMPLOYER', 'ADMIN'] as const)('allows an active %s without opening or applying to a job', async (role) => {
    const { student, job } = await reportFixture()
    await testDb.user.update({ where: { id: student.userId }, data: { role } })
    const result = await createReport({ userId: student.userId }, {
      jobId: job.id, reason: 'ASKS_PAYMENT', note: '  synthetic private note  ',
    })
    expect(result).toEqual({ reportId: expect.any(String) })
    expect(await testDb.jobReport.findUnique({ where: { id: result.reportId } })).toMatchObject({
      reporterId: student.userId, jobId: job.id, reason: 'ASKS_PAYMENT',
      note: 'synthetic private note', status: 'OPEN', resolverId: null, resolvedAt: null,
    })
    expect(await testDb.jobView.count()).toBe(0)
    expect(await testDb.application.count()).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it.each([
    { role: 'STUDENT', status: 'SUSPENDED' },
    { role: 'STUDENT', status: 'DELETED' },
    { role: 'EMPLOYER', status: 'SUSPENDED' },
    { role: 'EMPLOYER', status: 'DELETED' },
    { role: 'ADMIN', status: 'SUSPENDED' },
    { role: 'ADMIN', status: 'DELETED' },
  ] as const)('rejects a $role/$status reporter with no side effects', async (actor) => {
    const { student, job } = await reportFixture()
    await testDb.user.update({ where: { id: student.userId }, data: actor })
    await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
      .rejects.toBeInstanceOf(ForbiddenError)
    expect(await testDb.jobReport.count()).toBe(0)
    expect(await testDb.notification.count()).toBe(0)
  })

  it('uses the authenticated reporter rather than an extra reporterId input', async () => {
    const { student, employer, job } = await reportFixture()
    const input = { jobId: job.id, reason: 'OTHER' as const, reporterId: employer.userId }
    const result = await createReport({ userId: student.userId }, input)
    expect(await testDb.jobReport.findUnique({ where: { id: result.reportId } })).toMatchObject({
      reporterId: student.userId,
    })
  })

  it('rejects a missing reporter', async () => {
    const { job } = await reportFixture()
    await expect(createReport({ userId: 'missing-actor' }, { jobId: job.id, reason: 'OTHER' }))
      .rejects.toBeInstanceOf(ForbiddenError)
    expect(await testDb.jobReport.count()).toBe(0)
  })

  it.each(['DRAFT', 'PENDING_REVIEW', 'CLOSED', 'REJECTED'] as const)('hides a %s job', async (status) => {
    const { student, job } = await reportFixture()
    await testDb.job.update({ where: { id: job.id }, data: { status } })
    await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
      .rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.jobReport.count()).toBe(0)
  })

  it.each([-1, 0])('hides jobs whose deadline is %i milliseconds from now', async (offset) => {
    const { student, job } = await reportFixture()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T04:00:00Z'))
    await testDb.job.update({ where: { id: job.id }, data: { deadline: new Date(Date.now() + offset) } })
    await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
      .rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.jobReport.count()).toBe(0)
  })

  it('allows a future deadline', async () => {
    const { student, job } = await reportFixture()
    await testDb.job.update({ where: { id: job.id }, data: { deadline: new Date(Date.now() + 86_400_000) } })
    const result = await createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' })
    expect(await testDb.jobReport.findUnique({ where: { id: result.reportId } })).toMatchObject({
      jobId: job.id, reporterId: student.userId, status: 'OPEN', reason: 'OTHER', note: null,
    })
  })

  it('hides jobs belonging to inactive companies', async () => {
    const { student, employer, job } = await reportFixture()
    await testDb.company.update({ where: { id: employer.companyId }, data: { isActive: false } })
    await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
      .rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.jobReport.count()).toBe(0)
  })

  it('returns NotFound for a missing job', async () => {
    const { student } = await reportFixture()
    await expect(createReport({ userId: student.userId }, { jobId: 'missing-job', reason: 'OTHER' }))
      .rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.jobReport.count()).toBe(0)
  })

  it.each(['ASKS_PAYMENT', 'FAKE_SALARY', 'ILLEGAL_WORK', 'MISMATCH', 'OTHER'] as const)(
    'accepts reason %s with an optional empty note', async (reason) => {
      const { student, job } = await reportFixture()
      const result = await createReport({ userId: student.userId }, { jobId: job.id, reason, note: '   ' })
      expect(await testDb.jobReport.findUnique({ where: { id: result.reportId } })).toMatchObject({ reason, note: null })
    },
  )

  it.each([
    { reason: 'UNRECOGNIZED' as JobReportReason },
    { reason: 'OTHER' as const, note: 'x'.repeat(1001) },
  ])('rejects invalid report input without using allowance: %j', async (input) => {
    const { student, job } = await reportFixture()
    await testDb.systemSetting.create({ data: { key: 'limits.jobReportsPerDay', value: 1 } })
    await expect(createReport({ userId: student.userId }, { jobId: job.id, ...input }))
      .rejects.toBeInstanceOf(ValidationError)
    expect(await testDb.jobReport.count()).toBe(0)
    expect(await testDb.notification.count()).toBe(0)
    await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
      .resolves.toEqual({ reportId: expect.any(String) })
  })

  it('accepts exactly 1000 characters after trimming', async () => {
    const { student, job } = await reportFixture()
    const result = await createReport({ userId: student.userId }, {
      jobId: job.id, reason: 'OTHER', note: '  ' + 'x'.repeat(1000) + '  ',
    })
    expect(await testDb.jobReport.findUnique({ where: { id: result.reportId } })).toMatchObject({
      note: 'x'.repeat(1000),
    })
  })
})

describe('per-user report allowance', () => {
  it('allows the first ten reports and rejects the eleventh', async () => {
    const { student, job } = await reportFixture()
    for (let index = 0; index < 10; index++) {
      await createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' })
    }
    await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
      .rejects.toBeInstanceOf(RateLimitedError)
    expect(await testDb.jobReport.count({ where: { reporterId: student.userId } })).toBe(10)
  })

  it('commits exactly ten of eleven concurrent submissions', async () => {
    const { student, job } = await reportFixture()
    const results = await Promise.allSettled(Array.from({ length: 11 }, () =>
      createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }),
    ))
    const successes = results.filter((result) => result.status === 'fulfilled')
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(successes).toHaveLength(10)
    expect(failures).toHaveLength(1)
    expect(failures[0].reason).toBeInstanceOf(RateLimitedError)
    expect(await testDb.jobReport.count({ where: { reporterId: student.userId } })).toBe(10)
  })

  it('shares a custom allowance across jobs and keeps different users independent', async () => {
    const { student, employer, job } = await reportFixture()
    const otherStudent = await createStudent(testDb)
    const otherJob = await createJob(testDb, employer.companyId, employer.userId)
    await testDb.systemSetting.create({ data: { key: 'limits.jobReportsPerDay', value: 2 } })
    await createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' })
    await createReport({ userId: student.userId }, { jobId: otherJob.id, reason: 'OTHER' })
    await expect(createReport({ userId: student.userId }, { jobId: otherJob.id, reason: 'OTHER' }))
      .rejects.toBeInstanceOf(RateLimitedError)
    await expect(createReport({ userId: otherStudent.userId }, { jobId: otherJob.id, reason: 'OTHER' }))
      .resolves.toEqual({ reportId: expect.any(String) })
    expect(await testDb.jobReport.count({ where: { reporterId: student.userId } })).toBe(2)
    expect(await testDb.jobReport.count({ where: { reporterId: otherStudent.userId } })).toBe(1)
  })

  it.each(['RESOLVED', 'DISMISSED'] as const)('does not refund the allowance after %s', async (status) => {
    const { student, job } = await reportFixture()
    const admin = await createAdmin(testDb)
    await testDb.systemSetting.create({ data: { key: 'limits.jobReportsPerDay', value: 1 } })
    const report = await createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' })
    await resolveReport({ userId: admin.userId }, { reportId: report.reportId, status })
    await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
      .rejects.toBeInstanceOf(RateLimitedError)
    expect(await testDb.jobReport.count()).toBe(1)
  })

  it('resets exactly at Kuala Lumpur midnight (16:00 UTC)', async () => {
    const { student, job } = await reportFixture()
    // Fake Date only: Prisma network timers and the database clock stay real.
    vi.useFakeTimers({ toFake: ['Date'] })
    await seedReports(student.userId, job.id, 10, new Date('2026-11-08T16:00:00Z'))
    vi.setSystemTime(new Date('2026-11-09T15:59:59Z'))
    await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
      .rejects.toBeInstanceOf(RateLimitedError)
    vi.setSystemTime(new Date('2026-11-09T16:00:00Z'))
    await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
      .resolves.toEqual({ reportId: expect.any(String) })
    expect(await testDb.jobReport.count()).toBe(11)
  })

  it('excludes records before the day start and at the next day start', async () => {
    const { student, job } = await reportFixture()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T04:00:00Z'))
    await seedReports(student.userId, job.id, 10, new Date('2026-11-08T15:59:59.999Z'))
    await seedReports(student.userId, job.id, 10, new Date('2026-11-09T16:00:00Z'))
    await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
      .resolves.toEqual({ reportId: expect.any(String) })
    expect(await testDb.jobReport.count()).toBe(21)
  })

  it.each([0, -1, 1.5, 1001, '2', 'synthetic-invalid-setting'])(
    'falls back to ten for invalid historical setting %j', async (value) => {
      const { student, job } = await reportFixture()
      await testDb.systemSetting.create({ data: { key: 'limits.jobReportsPerDay', value } })
      await seedReports(student.userId, job.id, 9)
      await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
        .resolves.toEqual({ reportId: expect.any(String) })
      await expect(createReport({ userId: student.userId }, { jobId: job.id, reason: 'OTHER' }))
        .rejects.toBeInstanceOf(RateLimitedError)
      expect(await testDb.jobReport.count()).toBe(10)
      expect(warn).toHaveBeenCalledWith(
        { key: 'limits.jobReportsPerDay', defaultValue: 10 }, expect.any(String),
      )
      expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-invalid-setting')
    },
  )
})
