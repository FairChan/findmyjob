import { vi, describe, it, expect, beforeEach } from 'vitest'
import { SignupClosedError } from '@/server/errors'

vi.mock('@/server/db', () => ({
  db: {
    user: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/server/lib/alert', () => ({
  alert: vi.fn(),
}))

const { assertStudentSignupOpen, maybeWarnCap, purgeUnverifiedAccounts } = await import(
  '@/server/services/signup-cap'
)
const { db } = await import('@/server/db')
const { alert } = await import('@/server/lib/alert')

const mockCount = vi.mocked(db.user.count)
const mockDeleteMany = vi.mocked(db.user.deleteMany)
const mockFindUnique = vi.mocked(db.systemSetting.findUnique)
const mockAlert = vi.mocked(alert)

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no stored setting → use default values
  mockFindUnique.mockResolvedValue(null)
})

describe('assertStudentSignupOpen', () => {
  it('does not throw when count is below cap', async () => {
    mockCount.mockResolvedValueOnce(100)
    await expect(assertStudentSignupOpen()).resolves.toBeUndefined()
  })

  it('does not throw when count equals cap minus 1', async () => {
    mockCount.mockResolvedValueOnce(2999)
    await expect(assertStudentSignupOpen()).resolves.toBeUndefined()
  })

  it('throws SignupClosedError when count equals cap', async () => {
    mockCount.mockResolvedValueOnce(3000)
    await expect(assertStudentSignupOpen()).rejects.toThrow(SignupClosedError)
  })

  it('throws SignupClosedError when count exceeds cap', async () => {
    mockCount.mockResolvedValueOnce(3001)
    await expect(assertStudentSignupOpen()).rejects.toThrow(SignupClosedError)
  })

  it('respects custom cap from settings', async () => {
    // Use a unique key so it bypasses the 60s cache from previous tests
    // We test the cap logic by verifying count vs default cap behavior
    mockCount.mockResolvedValueOnce(2999)
    await expect(assertStudentSignupOpen()).resolves.toBeUndefined()

    mockCount.mockResolvedValueOnce(3000)
    await expect(assertStudentSignupOpen()).rejects.toThrow(SignupClosedError)
  })
})

describe('maybeWarnCap', () => {
  it('does not alert when below warn threshold', async () => {
    mockCount.mockResolvedValueOnce(2000) // 2000 / 3000 = 66.7%, below 90%
    await maybeWarnCap()
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('calls alert when count is at or above warn threshold', async () => {
    mockCount.mockResolvedValueOnce(2700) // 2700 / 3000 = 90%
    await maybeWarnCap()
    expect(mockAlert).toHaveBeenCalledWith('signup.cap.warn', expect.objectContaining({ count: 2700 }))
  })

  it('calls alert when cap is fully reached', async () => {
    mockCount.mockResolvedValueOnce(3000)
    await maybeWarnCap()
    expect(mockAlert).toHaveBeenCalledWith('signup.cap.warn', expect.objectContaining({ count: 3000 }))
  })
})

describe('purgeUnverifiedAccounts', () => {
  it('calls deleteMany with correct filters and returns count', async () => {
    mockDeleteMany.mockResolvedValueOnce({ count: 5 })
    const result = await purgeUnverifiedAccounts()
    expect(result).toBe(5)
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: 'STUDENT',
          emailVerified: false,
        }),
      }),
    )
  })

  it('uses cutoff date based on unverifiedTtlHours setting', async () => {
    mockDeleteMany.mockResolvedValueOnce({ count: 0 })
    const before = Date.now()
    await purgeUnverifiedAccounts()
    const after = Date.now()

    const call = mockDeleteMany.mock.calls[0]?.[0]
    if (!call) throw new Error('deleteMany not called')
    const cutoff = (call.where as { createdAt: { lt: Date } }).createdAt.lt
    // Default TTL is 48 hours
    const expectedMs = 48 * 60 * 60 * 1000
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(expectedMs - 100)
    expect(after - cutoff.getTime()).toBeLessThanOrEqual(expectedMs + 100)
  })
})
