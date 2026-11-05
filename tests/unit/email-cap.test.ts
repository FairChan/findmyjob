import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/services/settings', () => ({
  getSetting: vi.fn(),
}))

vi.mock('@/server/lib/db-rate-limit', () => ({
  hitBucket: vi.fn(),
}))

vi.mock('@/server/lib/alert', () => ({
  alert: vi.fn(),
}))

const { getSetting } = await import('@/server/services/settings')
const { hitBucket } = await import('@/server/lib/db-rate-limit')
const { alert } = await import('@/server/lib/alert')
const { checkEmailCap } = await import('@/server/lib/email-cap')

const mockGetSetting = vi.mocked(getSetting)
const mockHitBucket = vi.mocked(hitBucket)
const mockAlert = vi.mocked(alert)

function mockCapCheck(cap: number, count: number) {
  mockGetSetting.mockResolvedValueOnce(cap)
  mockHitBucket.mockResolvedValueOnce({
    allowed: count <= cap,
    remaining: Math.max(0, cap - count),
    resetAt: Date.now() + 86_400_000,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkEmailCap', () => {
  it('allows critical emails regardless of cap', async () => {
    const allowed = await checkEmailCap({ critical: true })
    expect(allowed).toBe(true)
    expect(mockHitBucket).not.toHaveBeenCalled()
  })

  it('allows non-critical email when under cap', async () => {
    mockCapCheck(500, 1)
    const allowed = await checkEmailCap({ critical: false })
    expect(allowed).toBe(true)
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('allows at exactly the cap limit', async () => {
    mockCapCheck(500, 500)
    const allowed = await checkEmailCap({ critical: false })
    expect(allowed).toBe(true)
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('blocks non-critical email when over cap and calls alert', async () => {
    mockCapCheck(500, 501)
    const allowed = await checkEmailCap({ critical: false })
    expect(allowed).toBe(false)
    expect(mockAlert).toHaveBeenCalledWith(
      'email.dailyCap.reached',
      expect.objectContaining({ cap: 500 }),
    )
  })
})
