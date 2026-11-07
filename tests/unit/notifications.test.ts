import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/env', () => ({ env: {} }))

const mockDb = vi.hoisted(() => ({
  notification: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
}))
vi.mock('@/server/db', () => ({ db: mockDb }))

import {
  listNotifications,
  markAllNotificationsRead,
  createNotification,
} from '@/server/services/notifications'

const USER_ID = 'cltest000000user00000'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listNotifications', () => {
  it('queries findMany with userId and desc order', async () => {
    mockDb.notification.findMany.mockResolvedValue([])
    await listNotifications({ userId: USER_ID })
    expect(mockDb.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        orderBy: { createdAt: 'desc' },
      }),
    )
  })

  it('returns mapped notification items', async () => {
    const now = new Date()
    mockDb.notification.findMany.mockResolvedValue([
      {
        id: 'notif-1',
        type: 'talent.unlock',
        payload: { companyId: 'comp-1' },
        readAt: null,
        createdAt: now,
      },
    ])
    const result = await listNotifications({ userId: USER_ID })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'notif-1',
      type: 'talent.unlock',
      payload: { companyId: 'comp-1' },
      readAt: null,
      createdAt: now,
    })
  })

  it('returns empty array when no notifications', async () => {
    mockDb.notification.findMany.mockResolvedValue([])
    expect(await listNotifications({ userId: USER_ID })).toEqual([])
  })

  it('defaults to limit 50', async () => {
    mockDb.notification.findMany.mockResolvedValue([])
    await listNotifications({ userId: USER_ID })
    expect(mockDb.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    )
  })

  it('respects custom limit', async () => {
    mockDb.notification.findMany.mockResolvedValue([])
    await listNotifications({ userId: USER_ID }, { limit: 10 })
    expect(mockDb.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    )
  })
})

describe('markAllNotificationsRead', () => {
  it('calls updateMany with userId and null readAt filter', async () => {
    mockDb.notification.updateMany.mockResolvedValue({ count: 2 })
    await markAllNotificationsRead({ userId: USER_ID })
    expect(mockDb.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })

  it('succeeds when no unread notifications exist', async () => {
    mockDb.notification.updateMany.mockResolvedValue({ count: 0 })
    await expect(markAllNotificationsRead({ userId: USER_ID })).resolves.toBeUndefined()
  })
})

describe('createNotification', () => {
  it('inserts a notification row via the provided writer', async () => {
    const mockWriter = { notification: { create: vi.fn().mockResolvedValue({}) } }
    await createNotification(mockWriter, USER_ID, 'talent.unlock', { companyId: 'comp-1' })
    expect(mockWriter.notification.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, type: 'talent.unlock', payload: { companyId: 'comp-1' } },
    })
  })
})
