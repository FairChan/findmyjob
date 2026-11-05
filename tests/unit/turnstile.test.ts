import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockEnv = vi.hoisted(() => ({
  TURNSTILE_SECRET_KEY: 'test-secret-key',
  APP_URL: 'https://app.example.test',
  APP_ENV: 'development' as string,
}))

vi.mock('@/env', () => ({ env: mockEnv }))

vi.mock('server-only', () => ({}))

const { verifyTurnstile, TurnstileError } = await import('@/server/lib/turnstile')

function mockFetch(response: object, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(response),
  })
}

describe('verifyTurnstile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves for a valid token with matching hostname and action', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ success: true, hostname: 'app.example.test', action: 'login' }),
    )
    await expect(verifyTurnstile('valid-token', { action: 'login' })).resolves.toBeUndefined()
  })

  it('throws TurnstileError when success is false', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: false, 'error-codes': ['invalid-input-response'] }))
    await expect(verifyTurnstile('bad-token', { action: 'login' })).rejects.toBeInstanceOf(TurnstileError)
  })

  it('throws TurnstileError on hostname mismatch', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ success: true, hostname: 'evil.example.com', action: 'login' }),
    )
    await expect(verifyTurnstile('token', { action: 'login' })).rejects.toThrow(/hostname mismatch/)
  })

  it('throws TurnstileError on action mismatch', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ success: true, hostname: 'app.example.test', action: 'other' }),
    )
    await expect(verifyTurnstile('token', { action: 'login' })).rejects.toThrow(/action mismatch/)
  })

  it('throws TurnstileError when fetch times out or throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')),
    )
    await expect(verifyTurnstile('token', { action: 'login' })).rejects.toBeInstanceOf(TurnstileError)
  })

  it('throws TurnstileError for empty token', async () => {
    await expect(verifyTurnstile('', { action: 'login' })).rejects.toBeInstanceOf(TurnstileError)
  })

  it('throws TurnstileError when siteverify returns a non-2xx status', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true, hostname: 'app.example.test', action: 'login' }, false))
    await expect(verifyTurnstile('token', { action: 'login' })).rejects.toThrow(/HTTP/)
  })

  it('outside production, tolerates missing hostname and action (Cloudflare test keys)', async () => {
    vi.stubGlobal('fetch', mockFetch({ success: true }))
    await expect(verifyTurnstile('token', { action: 'login' })).resolves.toBeUndefined()
  })

  it('outside production, accepts a Cloudflare testing-key result (hostname example.com, no action)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } }),
    )
    await expect(verifyTurnstile('XXXX.DUMMY.TOKEN.XXXX', { action: 'register' })).resolves.toBeUndefined()
  })

  describe('in production', () => {
    beforeEach(() => {
      mockEnv.APP_ENV = 'production'
    })
    afterEach(() => {
      mockEnv.APP_ENV = 'development'
    })

    it('rejects a response without hostname', async () => {
      vi.stubGlobal('fetch', mockFetch({ success: true, action: 'login' }))
      await expect(verifyTurnstile('token', { action: 'login' })).rejects.toThrow(/hostname mismatch/)
    })

    it('rejects a response without action', async () => {
      vi.stubGlobal('fetch', mockFetch({ success: true, hostname: 'app.example.test' }))
      await expect(verifyTurnstile('token', { action: 'login' })).rejects.toThrow(/action mismatch/)
    })

    it('rejects a Cloudflare testing-key result', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({ success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } }),
      )
      await expect(verifyTurnstile('token', { action: 'login' })).rejects.toThrow(/testing-key/)
    })

    it('accepts an exact hostname and action match', async () => {
      vi.stubGlobal('fetch', mockFetch({ success: true, hostname: 'app.example.test', action: 'login' }))
      await expect(verifyTurnstile('token', { action: 'login' })).resolves.toBeUndefined()
    })
  })
})
