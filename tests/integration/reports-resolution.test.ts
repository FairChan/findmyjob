import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))

const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/email', () => ({ createEmailProvider: vi.fn(() => ({ sendEmail })) }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createJob, createStudent } from '../factories'
import { listReports, resolveReport } from '@/server/services/reports'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'

setupTestDb()

async function reportFixture() {
  const admin = await createAdmin(testDb)
  const student = await createStudent(testDb)
  const employer = await createEmployer(testDb)
  const job = await createJob(testDb, employer.companyId, employer.userId)
  const report = await testDb.jobReport.create({
    data: { jobId: job.id, reporterId: student.userId, reason: 'OTHER', note: 'synthetic-private-note@example.test' },
  })
  return { admin, student, employer, job, report }
}

describe('report resolution', () => {
  it.each(['RESOLVED', 'DISMISSED'] as const)('transitions OPEN to %s with one exact audit and no job/company moderation', async (status) => {
    const { admin, employer, job, report } = await reportFixture()
    const before = Date.now()
    expect(await resolveReport({ userId: admin.userId }, { reportId: report.id, status }))
      .toEqual({ reportId: report.id, status })
    const saved = await testDb.jobReport.findUniqueOrThrow({ where: { id: report.id } })
    expect(saved).toMatchObject({ status, resolverId: admin.userId })
    expect(saved.resolvedAt).toBeInstanceOf(Date)
    expect(saved.resolvedAt!.getTime()).toBeGreaterThanOrEqual(before)
    expect(saved.resolvedAt!.getTime()).toBeLessThanOrEqual(Date.now())
    const audits = await testDb.auditLog.findMany({ where: { targetId: report.id } })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      action: 'job.report.resolve', targetType: 'JobReport', targetId: report.id, actorId: admin.userId,
    })
    expect(audits[0].metadata).toEqual({ jobId: job.id, fromStatus: 'OPEN', toStatus: status })
    expect(JSON.stringify(audits)).not.toContain(report.note)
    expect(await testDb.job.findUnique({ where: { id: job.id } })).toEqual(job)
    expect(await testDb.company.findUnique({ where: { id: employer.companyId } })).toMatchObject({ isActive: true })
  })

  it.each(['RESOLVED', 'DISMISSED'] as const)('preserves the first resolver/date on a repeated %s', async (status) => {
    const { admin, report } = await reportFixture()
    const secondAdmin = await createAdmin(testDb)
    await resolveReport({ userId: admin.userId }, { reportId: report.id, status })
    const first = await testDb.jobReport.findUnique({ where: { id: report.id } })
    expect(await resolveReport({ userId: secondAdmin.userId }, { reportId: report.id, status }))
      .toEqual({ reportId: report.id, status })
    expect(await testDb.jobReport.findUnique({ where: { id: report.id } })).toEqual(first)
    expect(await testDb.auditLog.count({ where: { action: 'job.report.resolve', targetId: report.id } })).toBe(1)
  })

  it.each([
    { first: 'RESOLVED', second: 'DISMISSED' },
    { first: 'DISMISSED', second: 'RESOLVED' },
  ] as const)('rejects $second after $first without replacing the original decision', async ({ first, second }) => {
    const { admin, report } = await reportFixture()
    await resolveReport({ userId: admin.userId }, { reportId: report.id, status: first })
    const original = await testDb.jobReport.findUnique({ where: { id: report.id } })
    await expect(resolveReport({ userId: admin.userId }, { reportId: report.id, status: second }))
      .rejects.toBeInstanceOf(ConflictError)
    expect(await testDb.jobReport.findUnique({ where: { id: report.id } })).toEqual(original)
    expect(await testDb.auditLog.count({ where: { targetId: report.id } })).toBe(1)
  })

  it('makes competing resolve/dismiss calls yield one winner, one conflict, and one audit', async () => {
    const { admin, job, report } = await reportFixture()
    const secondAdmin = await createAdmin(testDb)
    const requests = [
      { userId: admin.userId, status: 'RESOLVED' as const },
      { userId: secondAdmin.userId, status: 'DISMISSED' as const },
    ]
    const results = await Promise.allSettled(requests.map(({ userId, status }) =>
      resolveReport({ userId }, { reportId: report.id, status }),
    ))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(failures).toHaveLength(1)
    expect(failures[0].reason).toBeInstanceOf(ConflictError)
    const winner = requests[results.findIndex((result) => result.status === 'fulfilled')]
    expect(await testDb.jobReport.findUnique({ where: { id: report.id } })).toMatchObject({
      status: winner.status, resolverId: winner.userId, resolvedAt: expect.any(Date),
    })
    const audits = await testDb.auditLog.findMany({ where: { targetId: report.id } })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      actorId: winner.userId, action: 'job.report.resolve', targetType: 'JobReport', targetId: report.id,
    })
    expect(audits[0].metadata).toEqual({ jobId: job.id, fromStatus: 'OPEN', toStatus: winner.status })
  })

  it.each([
    { role: 'STUDENT', status: 'ACTIVE' },
    { role: 'EMPLOYER', status: 'ACTIVE' },
    { role: 'ADMIN', status: 'SUSPENDED' },
    { role: 'ADMIN', status: 'DELETED' },
  ] as const)('denies list and resolution to $role/$status', async (actor) => {
    const { admin, report } = await reportFixture()
    await testDb.user.update({ where: { id: admin.userId }, data: actor })
    await expect(listReports({ userId: admin.userId }, {})).rejects.toBeInstanceOf(ForbiddenError)
    await expect(resolveReport({ userId: admin.userId }, { reportId: report.id, status: 'RESOLVED' }))
      .rejects.toBeInstanceOf(ForbiddenError)
    expect(await testDb.jobReport.findUnique({ where: { id: report.id } })).toEqual(report)
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it('denies list and resolution to a missing actor', async () => {
    const { report } = await reportFixture()
    await expect(listReports({ userId: 'missing-actor' }, {})).rejects.toBeInstanceOf(ForbiddenError)
    await expect(resolveReport({ userId: 'missing-actor' }, { reportId: report.id, status: 'RESOLVED' }))
      .rejects.toBeInstanceOf(ForbiddenError)
    expect(await testDb.jobReport.findUnique({ where: { id: report.id } })).toEqual(report)
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it('uses the authenticated resolver rather than an extra resolverId input', async () => {
    const { admin, student, report } = await reportFixture()
    const input = {
      reportId: report.id, status: 'RESOLVED' as const, resolverId: student.userId,
      resolvedAt: new Date('2000-01-01T00:00:00Z'),
    }
    await resolveReport({ userId: admin.userId }, input)
    const saved = await testDb.jobReport.findUniqueOrThrow({ where: { id: report.id } })
    expect(saved.resolverId).toBe(admin.userId)
    expect(saved.resolvedAt).not.toEqual(input.resolvedAt)
    expect(await testDb.auditLog.findFirst({ where: { targetId: report.id } })).toMatchObject({
      actorId: admin.userId,
    })
  })

  it('returns NotFound for an absent report', async () => {
    const admin = await createAdmin(testDb)
    await expect(resolveReport({ userId: admin.userId }, { reportId: 'missing-report', status: 'RESOLVED' }))
      .rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it.each(['OPEN', 'INVALID'])('rejects resolution status %s', async (status) => {
    const { admin, report } = await reportFixture()
    await expect(resolveReport({ userId: admin.userId }, {
      reportId: report.id, status: status as 'RESOLVED',
    })).rejects.toBeInstanceOf(ValidationError)
    expect(await testDb.jobReport.findUnique({ where: { id: report.id } })).toEqual(report)
    expect(await testDb.auditLog.count()).toBe(0)
  })
})

describe('admin report queue', () => {
  it('paginates identical timestamps without missing or repeating records', async () => {
    const { admin, student, job, report } = await reportFixture()
    const ids = Array.from({ length: 51 }, () => randomUUID())
    await testDb.jobReport.createMany({
      data: ids.map((id) => ({
        id, jobId: job.id, reporterId: student.userId, reason: 'OTHER' as const, createdAt: report.createdAt,
      })),
    })
    const first = await listReports({ userId: admin.userId }, {})
    expect(first.items).toHaveLength(25)
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await listReports({ userId: admin.userId }, { cursor: first.nextCursor! })
    expect(second.items).toHaveLength(25)
    expect(second.nextCursor).toEqual(expect.any(String))
    const third = await listReports({ userId: admin.userId }, { cursor: second.nextCursor! })
    expect(third.items).toHaveLength(2)
    expect(third.nextCursor).toBeNull()
    expect([...first.items, ...second.items, ...third.items].map((row) => row.id).sort())
      .toEqual([...ids, report.id].sort())
    expect((await listReports({ userId: admin.userId }, { limit: 50 })).items).toHaveLength(50)
    expect(Object.keys(first.items[0]).sort()).toEqual([
      'id', 'jobId', 'jobTitle', 'companyName', 'reporterId', 'reason', 'note',
      'status', 'resolverId', 'resolvedAt', 'createdAt',
    ].sort())
  })

  it('combines job and status filters', async () => {
    const { admin, student, employer, job, report } = await reportFixture()
    await testDb.jobReport.create({
      data: { jobId: job.id, reporterId: student.userId, reason: 'OTHER', status: 'DISMISSED' },
    })
    const otherJob = await createJob(testDb, employer.companyId, employer.userId)
    await testDb.jobReport.create({ data: { jobId: otherJob.id, reporterId: student.userId, reason: 'OTHER' } })
    const result = await listReports({ userId: admin.userId }, { status: 'OPEN', jobId: job.id })
    expect(result.items.map((row) => row.id)).toEqual([report.id])
    expect(result.nextCursor).toBeNull()
  })

  it.each([{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { cursor: 'malformed-cursor' }])(
    'rejects invalid pagination %j', async (input) => {
      const admin = await createAdmin(testDb)
      await expect(listReports({ userId: admin.userId }, input)).rejects.toBeInstanceOf(ValidationError)
    },
  )
})
