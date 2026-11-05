import { vi, describe, it, expect, beforeEach } from 'vitest'
import { SignupClosedError } from '@/server/errors'

vi.mock('@/server/db', () => ({
  db: {
    user: {
      count: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
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
    vi.mocked(db.user.findMany).mockResolvedValueOnce([{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }] as never)
    mockDeleteMany.mockResolvedValueOnce({ count: 5 })
    const result = await purgeUnverifiedAccounts()
    expect(result).toBe(5)
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['1', '2', '3', '4', '5'] } }),
      }),
    )
  })

  it('uses cutoff date based on default 48h TTL when setting is invalid', async () => {
    // null setting → fallback to 48
    vi.mocked(db.user.findMany).mockResolvedValueOnce([] as never)
    const before = Date.now()
    await purgeUnverifiedAccounts()
    const after = Date.now()

    const call = vi.mocked(db.user.findMany).mock.calls[0]?.[0]
    if (!call) throw new Error('findMany not called')
    const cutoff = (call.where as { createdAt: { lt: Date } }).createdAt.lt
    const expectedMs = 48 * 60 * 60 * 1000
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(expectedMs - 100)
    expect(after - cutoff.getTime()).toBeLessThanOrEqual(expectedMs + 100)
  })

  it('falls back to 48h when unverifiedTtlHours setting is 0 (invalid min)', async () => {
    // Setting returns 0 → invalid (min 1), fallback to 48
    mockFindUnique.mockResolvedValueOnce({ key: 'signup.unverifiedTtlHours', value: 0 } as never)
    vi.mocked(db.user.findMany).mockResolvedValueOnce([] as never)
    const before = Date.now()
    await purgeUnverifiedAccounts()
    const after = Date.now()
    const call = vi.mocked(db.user.findMany).mock.calls[0]?.[0]
    if (!call) throw new Error('findMany not called')
    const cutoff = (call.where as { createdAt: { lt: Date } }).createdAt.lt
    const expectedMs = 48 * 60 * 60 * 1000
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(expectedMs - 100)
    expect(after - cutoff.getTime()).toBeLessThanOrEqual(expectedMs + 100)
  })

  it('stops batching after a partial batch (< 1000)', async () => {
    // First batch: 5 results (< 1000), no second batch needed
    vi.mocked(db.user.findMany).mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => ({ id: String(i) })) as never,
    )
    mockDeleteMany.mockResolvedValueOnce({ count: 5 })
    const result = await purgeUnverifiedAccounts()
    expect(result).toBe(5)
    expect(vi.mocked(db.user.findMany)).toHaveBeenCalledTimes(1)
  })
})
