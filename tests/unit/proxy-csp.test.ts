import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('next-intl/middleware', () => ({
  default: () => (request: NextRequest) => NextResponse.next({ request: { headers: request.headers } }),
}))

const { default: middleware } = await import('@/proxy')
afterEach(() => vi.unstubAllEnvs())

describe('request-specific enforced CSP', () => {
  it('uses the public Sentry build variable directly, matching browser instrumentation', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@sentry.example.test/42')
    const response = await middleware(new NextRequest('http://localhost:3002/zh'))
    expect(response.headers.get('content-security-policy')).toContain('https://sentry.example.test')
  })
  it('overwrites client nonce and gives Next the same policy as the browser', async () => {
    const response = await middleware(new NextRequest('http://localhost:3002/zh', {
      headers: { 'x-nonce': 'attacker', 'content-security-policy': "script-src 'unsafe-inline'" },
    }))
    const policy = response.headers.get('content-security-policy')
    expect(policy).toBeTruthy()
    expect(policy).toContain("'strict-dynamic'")
    const nonce = policy!.match(/'nonce-([^']+)'/)?.[1]
    expect(nonce).toBeTruthy()
    expect(nonce).not.toBe('attacker')
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce)
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy)
    expect(response.headers.get('content-security-policy-report-only')).toBeNull()
  })

  it('uses a fresh nonce for each page request including redirects', async () => {
    const first = await middleware(new NextRequest('http://localhost:3002/zh/login'))
    const second = await middleware(new NextRequest('http://localhost:3002/zh/login'))
    expect(first.headers.get('content-security-policy')).toBeTruthy()
    expect(first.headers.get('content-security-policy')).not.toBe(second.headers.get('content-security-policy'))
    const redirect = await middleware(new NextRequest('http://localhost:3002/zh/admin'))
    expect(redirect.status).toBe(307)
    expect(redirect.headers.get('content-security-policy')).toContain("'nonce-")
  })

  it('does not override API response policies such as sandboxed downloads', async () => {
    const response = await middleware(new NextRequest('http://localhost:3002/api/health'))
    expect(response.headers.get('content-security-policy')).toBeNull()
  })
})
