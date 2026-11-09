import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))

const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/email', () => ({ createEmailProvider: vi.fn(() => ({ sendEmail })) }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createJob, createStudent } from '../factories'
import { createReport, listReports, resolveReport } from '@/server/services/reports'
import { clearSettingsCache } from '@/server/services/settings'
import * as notify from '@/server/services/notify'

setupTestDb()
beforeEach(() => { clearSettingsCache(); vi.clearAllMocks() })
afterEach(() => vi.restoreAllMocks())

describe('report creation through the real notification helper', () => {
  it('notifies each active admin once, then exposes the same report in the queue and audit', async () => {
    const admin = await createAdmin(testDb)
    const secondAdmin = await createAdmin(testDb)
    const suspended = await createAdmin(testDb)
    const deleted = await createAdmin(testDb)
    await testDb.user.update({ where: { id: suspended.userId }, data: { status: 'SUSPENDED' } })
    await testDb.user.update({ where: { id: deleted.userId }, data: { status: 'DELETED' } })
    const student = await createStudent(testDb)
    const employer = await createEmployer(testDb)
    const job = await createJob(testDb, employer.companyId, employer.userId)
    // Spy keeps the real helper and notification inserts; only email transport is mocked.
    const notifySpy = vi.spyOn(notify, 'notifyNewReport')
    const result = await createReport({ userId: student.userId }, {
      jobId: job.id, reason: 'ASKS_PAYMENT', note: 'synthetic-private-note@example.test',
    })
    expect(notifySpy).toHaveBeenCalledTimes(1)
    expect(notifySpy).toHaveBeenCalledWith(result.reportId)
    const notifications = await testDb.notification.findMany({ where: { type: 'report.new' } })
    expect(notifications).toHaveLength(2)
    expect(notifications.map((row) => row.userId).sort()).toEqual([admin.userId, secondAdmin.userId].sort())
    expect(notifications.map((row) => row.payload)).toEqual([
      { reportId: result.reportId }, { reportId: result.reportId },
    ])
    expect(sendEmail).not.toHaveBeenCalled()

    const queue = await listReports({ userId: admin.userId }, { status: 'OPEN' })
    expect(queue.items.map((row) => row.id)).toEqual([result.reportId])
    await resolveReport({ userId: admin.userId }, { reportId: result.reportId, status: 'RESOLVED' })
    const resolved = await listReports({ userId: admin.userId }, { status: 'RESOLVED' })
    expect(resolved.items.map((row) => row.id)).toEqual([result.reportId])
    expect((await listReports({ userId: admin.userId }, { status: 'OPEN' })).items).toEqual([])
    expect(await testDb.auditLog.findMany({ where: { targetId: result.reportId } })).toEqual([
      expect.objectContaining({
        actorId: admin.userId, action: 'job.report.resolve',
        targetType: 'JobReport', targetId: result.reportId,
        metadata: { jobId: job.id, fromStatus: 'OPEN', toStatus: 'RESOLVED' },
      }),
    ])
    expect(await testDb.notification.count({ where: { type: 'report.new' } })).toBe(2)
    expect(notifySpy).toHaveBeenCalledTimes(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
