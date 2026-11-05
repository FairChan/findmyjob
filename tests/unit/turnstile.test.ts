import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/env', () => ({
  env: {
    TURNSTILE_SECRET_KEY: 'test-secret-key',
    APP_URL: 'https://app.example.test',
  },
}))

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
})
