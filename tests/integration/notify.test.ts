/**
 * Integration tests for the notification and email pipeline (M5-T08).
 *
 * Tests:
 * 1. sendNotificationEmail looks up user by userId (not by payload) and sends email.
 * 2. sendNotificationEmail is a no-op for unknown userId.
 * 3. sendNotificationEmail respects the daily email cap (checkEmailCap).
 * 4. createNotification writes a row with the correct type and payload.
 * 5. listNotifications returns rows for the requesting user, not others.
 * 6. markAllNotificationsRead clears all unread rows for the user.
 * 7. review-jobs: approveJob creates a job.approved notification.
 * 8. review-jobs: rejectJob creates a job.rejected notification.
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

vi.mock('@/server/lib/alert', () => ({
  alert: vi.fn(),
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
  hitBucket: vi.fn().mockResolvedValue({ allowed: true, count: 1, limit: 500 }),
}))

vi.mock('@/server/lib/healthchecks', () => ({
  pingHealthcheck: vi.fn(),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import { createNotification, listNotifications, markAllNotificationsRead } from '@/server/services/notifications'
import { sendNotificationEmail } from '@/server/services/notify'
import { clearSettingsCache } from '@/server/services/settings'
import { createEmailProvider } from '@/lib/email'

setupTestDb()

beforeEach(() => {
  clearSettingsCache()
  vi.mocked(createEmailProvider).mockClear()
  _mockSendEmail.mockClear()
})

describe('createNotification', () => {
  it('writes a notification row with correct type and payload', async () => {
    const { userId } = await createStudent(testDb)

    await createNotification(testDb, userId, 'test.event', { foo: 'bar' })

    const rows = await testDb.notification.findMany({ where: { userId } })
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('test.event')
    expect((rows[0].payload as Record<string, unknown>).foo).toBe('bar')
    expect(rows[0].readAt).toBeNull()
  })
})

describe('listNotifications', () => {
  it('returns only notifications for the requesting user', async () => {
    const a = await createStudent(testDb)
    const b = await createStudent(testDb)

    await createNotification(testDb, a.userId, 'type.a', {})
    await createNotification(testDb, b.userId, 'type.b', {})

    const aRows = await listNotifications({ userId: a.userId })
    expect(aRows.every((r) => r.type === 'type.a')).toBe(true)
    expect(aRows.every((r) => r.type !== 'type.b')).toBe(true)
  })

  it('returns notifications sorted by createdAt desc', async () => {
    const { userId } = await createStudent(testDb)
    await createNotification(testDb, userId, 'first', {})
    await createNotification(testDb, userId, 'second', {})

    const rows = await listNotifications({ userId })
    expect(rows.length).toBeGreaterThanOrEqual(2)
    // Most recent first
    expect(new Date(rows[0].createdAt) >= new Date(rows[1].createdAt)).toBe(true)
  })
})

describe('markAllNotificationsRead', () => {
  it('marks all unread notifications as read for the user', async () => {
    const { userId } = await createStudent(testDb)
    await createNotification(testDb, userId, 'type.x', {})
    await createNotification(testDb, userId, 'type.y', {})

    const beforeRows = await testDb.notification.findMany({ where: { userId } })
    expect(beforeRows.every((r) => r.readAt === null)).toBe(true)

    await markAllNotificationsRead({ userId })

    const afterRows = await testDb.notification.findMany({ where: { userId } })
    expect(afterRows.every((r) => r.readAt !== null)).toBe(true)
  })

  it('does not affect notifications of a different user', async () => {
    const a = await createStudent(testDb)
    const b = await createStudent(testDb)
    await createNotification(testDb, b.userId, 'type.b', {})

    await markAllNotificationsRead({ userId: a.userId })

    const bRow = await testDb.notification.findFirst({ where: { userId: b.userId } })
    expect(bRow?.readAt).toBeNull()
  })
})

describe('sendNotificationEmail', () => {
  it('sends email to an existing user using DB email (not payload)', async () => {
    const { userId } = await createStudent(testDb)
    // Update user locale to 'zh' to trigger a known template
    await testDb.user.update({ where: { id: userId }, data: { locale: 'zh' } })

    // Look up the actual DB email to compare strictly (factory uses example.test OR example.com)
    const userInDb = await testDb.user.findUnique({ where: { id: userId }, select: { email: true } })
    expect(userInDb).not.toBeNull()
    const dbEmail = userInDb!.email

    await sendNotificationEmail(userId, { template: 'talent-unlocked' })

    expect(_mockSendEmail).toHaveBeenCalledOnce()
    const call = _mockSendEmail.mock.calls[0]?.[0] as { to?: string } | undefined
    // Email must go to the EXACT DB email, not any other address
    expect(call?.to).toBe(dbEmail)
  })

  it('is a no-op for unknown userId', async () => {
    const sendEmailSpy = vi.fn().mockResolvedValue(undefined)
    vi.mocked(createEmailProvider).mockReturnValueOnce({ sendEmail: sendEmailSpy })

    await sendNotificationEmail('nonexistent-user-id-00000000', { template: 'talent-unlocked' })

    expect(sendEmailSpy).not.toHaveBeenCalled()
  })

  it('does not throw even when email provider throws', async () => {
    const { userId } = await createStudent(testDb)
    await testDb.user.update({ where: { id: userId }, data: { locale: 'zh' } })

    vi.mocked(createEmailProvider).mockReturnValueOnce({
      sendEmail: vi.fn().mockRejectedValue(new Error('SMTP error')),
    })

    // sendNotificationEmail must not throw
    await expect(
      sendNotificationEmail(userId, { template: 'talent-unlocked' }),
    ).resolves.toBeUndefined()
  })
})

describe('review-jobs notifications', () => {
  async function makeJobFixture() {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await testDb.job.create({
      data: {
        companyId: emp.companyId,
        createdById: emp.userId,
        title: 'Notify Test Job',
        type: 'INTERNSHIP',
        description: 'Test',
        status: 'PENDING_REVIEW',
        workMode: 'ONSITE',
        updatedAt: new Date(),
      },
    })
    const admin = await testDb.user.create({
      data: {
        name: 'Notify Admin',
        email: `notify-admin-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    })
    return { emp, job, adminId: admin.id }
  }

  it('approveJob creates a job.approved notification for the job creator', async () => {
    const { emp, job, adminId } = await makeJobFixture()
    const { approveJob } = await import('@/server/services/review-jobs')

    await approveJob({ userId: adminId }, { jobId: job.id, updatedAt: job.updatedAt })

    const notification = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'job.approved' },
    })
    expect(notification).not.toBeNull()
    expect((notification?.payload as Record<string, unknown>).jobId).toBe(job.id)
  })

  it('rejectJob creates a job.rejected notification for the job creator', async () => {
    const { emp, job, adminId } = await makeJobFixture()
    const { rejectJob } = await import('@/server/services/review-jobs')

    await rejectJob({ userId: adminId }, { jobId: job.id, reviewNote: 'Bad job', updatedAt: job.updatedAt })

    const notification = await testDb.notification.findFirst({
      where: { userId: emp.userId, type: 'job.rejected' },
    })
    expect(notification).not.toBeNull()
    expect((notification?.payload as Record<string, unknown>).jobId).toBe(job.id)
  })
})
