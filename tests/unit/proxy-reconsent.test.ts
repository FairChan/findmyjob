/**
 * Tests that checkReconsent uses a fixed INTERNAL_BASE_URL and never constructs
 * the fetch target from the incoming Host/X-Forwarded-Host header.
 *
 * Security: without the fix, an attacker with control over the Host header
 * could cause the middleware to send the session cookie to an arbitrary host
 * (SSRF via host-header injection).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// Set BEFORE the proxy module is imported so the module-level constant picks it up.
process.env.INTERNAL_BASE_URL = 'http://127.0.0.1:3000'

// next-intl's middleware can't resolve under Vitest's ESM resolver — stub it out.
vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }))

// Stub global fetch before importing the proxy to intercept internal calls.
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { default: middleware } = await import('@/proxy')

function reqWithCookie(path: string, origin: string) {
  return new NextRequest(new URL(path, origin), {
    headers: { cookie: 'better-auth.session_token=abc.def' },
  })
}

describe('checkReconsent: internal URL must not be derived from request host', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    // Default: no reconsent needed
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ needsReconsent: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('does NOT send fetch to evil.example when Host header is forged', async () => {
    const req = reqWithCookie('/zh', 'https://evil.example')
    await middleware(req)

    for (const [url] of mockFetch.mock.calls) {
      expect(String(url), 'fetch must not use the host-derived origin').not.toContain('evil.example')
    }
  })

  it('sends the internal fetch to INTERNAL_BASE_URL (127.0.0.1:3000)', async () => {
    const req = reqWithCookie('/zh', 'https://app.findmyjob.example')
    await middleware(req)

    const calledUrls = mockFetch.mock.calls.map((args) => String(args[0]))
    expect(
      calledUrls.some(u => u.startsWith('http://127.0.0.1:3000')),
      `expected a fetch to http://127.0.0.1:3000 but got: ${JSON.stringify(calledUrls)}`,
    ).toBe(true)
  })

  it('redirects to /{locale}/legal/reconsent when needsReconsent=true', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ needsReconsent: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const req = reqWithCookie('/zh/s/profile', 'https://app.example.test')
    const res = await middleware(req)

    expect(res.status, 'should redirect (307)').toBe(307)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/zh/legal/reconsent')
  })
})
