import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import middleware from '@/proxy'

vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }))
vi.mock('@/env', () => ({ env: { APP_ENV: 'test' } }))
const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => Response.json({ needsReconsent: true }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
function request(path: string, cookie = true, rsc = false) {
  return new NextRequest(new URL(path, 'https://app.example.test'), { headers: {
    ...(cookie ? { cookie: 'better-auth.session_token=synthetic.signature' } : {}), ...(rsc ? { RSC: '1' } : {}),
  } })
}
describe('narrow reconsent access for withdrawal pages', () => {
  it.each(['/zh/s/privacy', '/en/s/privacy', '/zh/e/preferences', '/en/e/preferences'])('allows %s with a session while legal consent is stale', async path => {
    const response = await middleware(request(path))
    expect(response.status).toBe(200); expect(response.headers.get('location')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    expect(response.headers.get('content-security-policy')).not.toBeNull()
  })
  it('also allows a real RSC navigation to the same withdrawal page', async () => {
    expect((await middleware(request('/en/e/preferences', true, true))).status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('keeps a HEAD request reachable without querying stale legal consent', async () => {
    const request = new NextRequest('https://app.example.test/en/e/preferences', {
      method: 'HEAD', headers: { cookie: 'better-auth.session_token=synthetic.signature' },
    })
    expect((await middleware(request)).status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['/zh/s/profile', '/en/e/talent', '/en/s/privacy/exports/synthetic', '/zh/e/preferences/other'])('does not exempt unrelated or descendant route %s', async path => {
    const response = await middleware(request(path))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/legal/reconsent')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it.each(['/zh/s/privacy', '/en/e/preferences'])('still requires login at %s', async path => {
    const response = await middleware(request(path, false))
    expect(response.status).toBe(307); expect(response.headers.get('location')).toContain('/login')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
