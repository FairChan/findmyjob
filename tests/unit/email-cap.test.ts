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
const { checkEmailCap, CRITICAL_TEMPLATES } = await import('@/server/lib/email-cap')

const mockGetSetting = vi.mocked(getSetting)
const mockHitBucket = vi.mocked(hitBucket)
const mockAlert = vi.mocked(alert)

function mockCapCheck(cap: number, count: number) {
  mockGetSetting.mockResolvedValueOnce(cap)
  mockHitBucket.mockResolvedValueOnce({
    allowed: count <= cap,
    remaining: Math.max(0, cap - count),
    resetAt: Date.now() + 86_400_000,
    count,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CRITICAL_TEMPLATES whitelist', () => {
  it('contains otp, password-reset, email-verify', () => {
    expect(CRITICAL_TEMPLATES.has('otp')).toBe(true)
    expect(CRITICAL_TEMPLATES.has('password-reset')).toBe(true)
    expect(CRITICAL_TEMPLATES.has('email-verify')).toBe(true)
  })
})

describe('checkEmailCap', () => {
  it('allows whitelisted templates without hitting the bucket', async () => {
    for (const tpl of ['otp', 'password-reset', 'email-verify']) {
      const allowed = await checkEmailCap({ template: tpl })
      expect(allowed).toBe(true)
    }
    expect(mockHitBucket).not.toHaveBeenCalled()
  })

  it('allows non-critical template when under cap', async () => {
    mockCapCheck(500, 1)
    const allowed = await checkEmailCap({ template: 'newsletter' })
    expect(allowed).toBe(true)
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('allows at exactly the cap limit', async () => {
    mockCapCheck(500, 500)
    const allowed = await checkEmailCap({ template: 'newsletter' })
    expect(allowed).toBe(true)
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('blocks and alerts exactly once when count is cap+1 (501)', async () => {
    mockCapCheck(500, 501)
    const allowed = await checkEmailCap({ template: 'newsletter' })
    expect(allowed).toBe(false)
    expect(mockAlert).toHaveBeenCalledOnce()
    expect(mockAlert).toHaveBeenCalledWith(
      'email.dailyCap.reached',
      expect.objectContaining({ cap: 500 }),
    )
  })

  it('blocks but does NOT alert when count is cap+2 (502)', async () => {
    mockCapCheck(500, 502)
    const allowed = await checkEmailCap({ template: 'newsletter' })
    expect(allowed).toBe(false)
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('blocks a non-whitelisted template even when named like a critical one', async () => {
    mockCapCheck(500, 501)
    const allowed = await checkEmailCap({ template: 'my-critical-otp-clone' })
    expect(allowed).toBe(false)
  })
})
