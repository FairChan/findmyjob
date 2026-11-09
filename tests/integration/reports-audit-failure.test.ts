import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))

const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/email', () => ({ createEmailProvider: vi.fn(() => ({ sendEmail })) }))

vi.mock('@/server/services/audit', () => ({
  logAudit: vi.fn().mockRejectedValue(new Error('synthetic report audit failure')),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createJob, createStudent } from '../factories'
import { resolveReport } from '@/server/services/reports'

setupTestDb()

describe('report resolution audit atomicity', () => {
  it.each(['RESOLVED', 'DISMISSED'] as const)('rolls back %s if the audit fails', async (status) => {
    const admin = await createAdmin(testDb)
    const student = await createStudent(testDb)
    const employer = await createEmployer(testDb)
    const job = await createJob(testDb, employer.companyId, employer.userId)
    const report = await testDb.jobReport.create({
      data: { jobId: job.id, reporterId: student.userId, reason: 'OTHER', note: 'synthetic private note' },
    })
    await expect(resolveReport({ userId: admin.userId }, { reportId: report.id, status }))
      .rejects.toThrow('synthetic report audit failure')
    expect(await testDb.jobReport.findUnique({ where: { id: report.id } })).toEqual(report)
    expect(await testDb.auditLog.count()).toBe(0)
  })
})
