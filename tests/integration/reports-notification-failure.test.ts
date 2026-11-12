import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
const fault = vi.hoisted(() => ({
  mode: 'lookup' as 'lookup' | 'write',
  hits: 0,
  committedReports: 0,
}))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return {
    db: testDb.$extends({
      query: {
        user: {
          async findMany({ args, query }) {
            if (fault.mode === 'lookup' && args.where?.role === 'ADMIN') {
              fault.hits++
              fault.committedReports = await testDb.jobReport.count()
              throw new Error('synthetic-sensitive-database-error')
            }
            return query(args)
          },
        },
        notification: {
          async create({ args, query }) {
            if (fault.mode === 'write') {
              fault.hits++
              fault.committedReports = await testDb.jobReport.count()
              throw new Error('synthetic-sensitive-database-error')
            }
            return query(args)
          },
        },
      },
    }),
  }
})
const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/email', () => ({ createEmailProvider: vi.fn(() => ({ sendEmail })) }))

const errorLog = vi.hoisted(() => vi.fn())
vi.mock('@/server/lib/logger', () => ({
  logger: { error: errorLog, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createJob, createStudent } from '../factories'
import { createReport } from '@/server/services/reports'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(() => {
  clearSettingsCache()
  vi.clearAllMocks()
  fault.hits = 0
  fault.committedReports = 0
})

describe('report notification failure isolation', () => {
  it.each(['lookup', 'write'] as const)('keeps a committed report successful when the real helper fails at %s', async (mode) => {
    fault.mode = mode
    await createAdmin(testDb)
    const student = await createStudent(testDb)
    const employer = await createEmployer(testDb)
    const job = await createJob(testDb, employer.companyId, employer.userId)
    const result = await createReport({ userId: student.userId }, {
      jobId: job.id, reason: 'OTHER', note: 'synthetic-private-note@example.test',
    })
    expect(result).toEqual({ reportId: expect.any(String) })
    expect(fault.hits).toBe(1)
    // A separate DB query observed the row before the helper failed: notification is post-commit.
    expect(fault.committedReports).toBe(1)
    expect(await testDb.jobReport.findMany()).toEqual([
      expect.objectContaining({
        id: result.reportId, reporterId: student.userId, jobId: job.id,
        reason: 'OTHER', note: 'synthetic-private-note@example.test', status: 'OPEN',
      }),
    ])
    expect(await testDb.notification.count()).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(errorLog).toHaveBeenCalled()
    const logged = JSON.stringify(errorLog.mock.calls, (_key, value: unknown) =>
      value instanceof Error ? { message: value.message } : value,
    )
    expect(logged).not.toContain('synthetic-private-note@example.test')
    expect(logged).not.toContain('synthetic-sensitive-database-error')
  })
})
