/**
 * Tests for /api/csp-report route.
 *
 * The route must:
 * - Return 204 for a valid CSP report
 * - Return 204 for oversized/malformed bodies (not 500)
 * - Not log the full blocked-uri URL or query string — only the hostname
 * - Rate-limit by IP
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/server/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/server/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 119, resetAt: Date.now() + 60_000, count: 1 }),
}))

vi.mock('@/server/lib/client-ip', () => ({
  getClientIp: vi.fn().mockReturnValue('1.2.3.4'),
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { POST } from '@/app/api/csp-report/route'
import { logger } from '@/server/lib/logger'
import { checkRateLimit } from '@/server/lib/rate-limit'

function makeRequest(body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/csp-report', {
    method: 'POST',
    // Origin must be present so route.ts origin-check does not block the request.
    // When APP_URL is unset, getAllowedOrigin() returns null and any non-null origin passes.
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001', ...extraHeaders },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as Mock).mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60_000,
    count: 1,
  })
})

describe('POST /api/csp-report', () => {
  it('returns 204 for a valid CSP report', async () => {
    const req = makeRequest({
      'csp-report': {
        'effective-directive': 'script-src',
        'blocked-uri': 'https://evil.example.com/malware.js?token=secret',
        'document-uri': 'https://app.findmyjob.example.com/zh/jobs',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(204)
  })

  it('logs only directive and blocked-uri HOST — not full URL or query string', async () => {
    const req = makeRequest({
      'csp-report': {
        'effective-directive': 'script-src',
        'blocked-uri': 'https://evil.example.com/path?secret=abc',
      },
    })
    await POST(req)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({
        directive: 'script-src',
        blockedUriHost: 'evil.example.com',
      }),
      'csp-violation',
    )
    // Must NOT log the full URL
    const args = vi.mocked(logger.warn).mock.calls[0]
    expect(JSON.stringify(args)).not.toContain('/path')
    expect(JSON.stringify(args)).not.toContain('secret=abc')
  })

  it('handles inline/eval keyword blocked-uri without throwing', async () => {
    const req = makeRequest({
      'csp-report': {
        'effective-directive': 'script-src',
        'blocked-uri': 'eval',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(204)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ blockedUriHost: 'eval' }),
      'csp-violation',
    )
  })

  it('returns 204 for malformed JSON without throwing', async () => {
    const req = new Request('http://localhost/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
      body: '{not json}}',
    })
    const res = await POST(req)
    expect(res.status).toBe(204)
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled()
  })

  it('returns 204 (not 500) for an oversized body', async () => {
    const bigString = 'x'.repeat(1024 * 1024)
    const req = new Request('http://localhost/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
      body: JSON.stringify({ 'csp-report': { 'blocked-uri': bigString } }),
    })
    const res = await POST(req)
    expect(res.status).toBe(204)
  })

  it('returns 204 (silent drop) when rate limit is exceeded', async () => {
    ;(checkRateLimit as Mock).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      count: 121,
    })
    const req = makeRequest({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://x.com/a' } })
    const res = await POST(req)
    expect(res.status).toBe(204)
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled()
  })
})
