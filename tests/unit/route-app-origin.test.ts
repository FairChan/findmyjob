/**
 * MA1-T01: route({ origin: 'app' }) only admits the Android app (exact scheme origin from
 * MOBILE_APP_ORIGINS, sent as Origin or — when Origin is absent — expo-origin), for every
 * method. Browsers cannot forge Origin, so this is the CSRF boundary for /api/m/v1.
 * route({ origin: 'web+app' }) is the upload endpoint's opt-in; the default stays web-only.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/server/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/server/authz', () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: 'u1' }),
  requireStudent: vi.fn().mockResolvedValue({ userId: 'u1' }),
  requireAdmin: vi.fn().mockResolvedValue({ userId: 'u1' }),
}))
const getSetting = vi.fn()
vi.mock('@/server/services/settings', () => ({ getSetting: (...a: unknown[]) => getSetting(...a) }))

import { route } from '@/server/route'
import { parseAppOrigins, requestAppOrigin } from '@/server/lib/app-origin'

const APP = 'findmyjob-staging://'

function req(method: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/m/v1/me', {
    method,
    headers: { 'x-app-version': '0.1.0', ...headers },
    body: method === 'GET' ? undefined : '{}',
  })
}

const ok = () => vi.fn(async () => new Response(JSON.stringify({ ok: true, data: 1 }), { status: 200 }))

describe('parseAppOrigins', () => {
  it('keeps only exact custom-scheme origins', () => {
    expect(
      parseAppOrigins(' findmyjob://, findmyjob-dev:// ,https://evil.example,http://,https://, javascript://,exp://,findmyjob'),
    ).toEqual(['findmyjob://', 'findmyjob-dev://'])
    expect(parseAppOrigins(undefined)).toEqual([])
  })
})

describe('requestAppOrigin', () => {
  it('prefers Origin and only falls back to expo-origin when Origin is absent', () => {
    expect(requestAppOrigin(req('GET', { origin: 'https://evil.example', 'expo-origin': APP }).headers)).toBe(
      'https://evil.example',
    )
    expect(requestAppOrigin(req('GET', { 'expo-origin': APP }).headers)).toBe(APP)
    expect(requestAppOrigin(req('GET').headers)).toBeNull()
  })
})

describe("route({ origin: 'app' })", () => {
  beforeEach(() => {
    vi.stubEnv('MOBILE_APP_ORIGINS', APP)
    getSetting.mockReset().mockResolvedValue('0.1.0')
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['GET', 'POST'])('%s from the app (expo-origin) reaches the handler', async (method) => {
    const handler = ok()
    const res = await route({ auth: 'user', origin: 'app' }, handler)(req(method, { 'expo-origin': APP }))
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-robots-tag')).toContain('noindex')
  })

  it('accepts the app origin sent as Origin', async () => {
    const res = await route({ auth: 'user', origin: 'app' }, ok())(req('POST', { origin: APP }))
    expect(res.status).toBe(200)
  })

  it.each([
    ['browser origin (same site)', { origin: 'http://localhost:3000' }],
    ['browser origin (foreign)', { origin: 'https://evil.example' }],
    ['no origin at all', {}],
    ['prefix look-alike scheme', { 'expo-origin': 'findmyjob-staging-evil://' }],
    ['other variant scheme', { 'expo-origin': 'findmyjob://' }],
    ['browser origin that also sets expo-origin', { origin: 'https://evil.example', 'expo-origin': APP }],
  ])('rejects %s with 403 for GET and POST', async (_label, headers) => {
    for (const method of ['GET', 'POST']) {
      const handler = ok()
      const res = await route({ auth: 'user', origin: 'app' }, handler)(req(method, headers))
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ ok: false, code: 'FORBIDDEN' })
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it('rejects everything when MOBILE_APP_ORIGINS is not configured', async () => {
    vi.stubEnv('MOBILE_APP_ORIGINS', '')
    const handler = ok()
    const res = await route({ auth: 'user', origin: 'app' }, handler)(req('GET', { 'expo-origin': APP }))
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 426 APP_UPDATE_REQUIRED below mobile.minSupportedVersion, before auth', async () => {
    getSetting.mockResolvedValue('0.2.0')
    const handler = ok()
    const res = await route({ auth: 'user', origin: 'app' }, handler)(req('GET', { 'expo-origin': APP }))
    expect(res.status).toBe(426)
    expect(await res.json()).toEqual({ ok: false, code: 'APP_UPDATE_REQUIRED' })
    expect(getSetting).toHaveBeenCalledWith('mobile.minSupportedVersion', '0.0.0')
    expect(handler).not.toHaveBeenCalled()
  })

  it('treats a missing or malformed version header as too old', async () => {
    getSetting.mockResolvedValue('0.0.0')
    const variants: Array<Record<string, string>> = [{ 'expo-origin': APP }, { 'expo-origin': APP, 'x-app-version': 'v1' }]
    for (const headers of variants) {
      const handler = ok()
      const r = new Request('http://localhost:3000/api/m/v1/config', { headers })
      const res = await route({ auth: 'public', origin: 'app' }, handler)(r)
      expect(res.status).toBe(426)
      expect(handler).not.toHaveBeenCalled()
    }
  })
})

describe("route({ origin: 'web+app' })", () => {
  beforeEach(() => {
    vi.stubEnv('MOBILE_APP_ORIGINS', APP)
    vi.stubEnv('APP_URL', 'http://localhost:3000')
    vi.stubEnv('APP_ENV', 'production')
    getSetting.mockReset().mockResolvedValue('0.0.0')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('accepts the web origin and the app origin, rejects others', async () => {
    const cases: Array<[Record<string, string>, number]> = [
      [{ origin: 'http://localhost:3000' }, 200],
      [{ 'expo-origin': APP }, 200],
      [{ origin: 'https://evil.example' }, 403],
      [{}, 403],
    ]
    for (const [headers, status] of cases) {
      const res = await route({ auth: 'user', origin: 'web+app' }, ok())(req('POST', headers))
      expect(res.status).toBe(status)
    }
  })
})

describe('default origin (web)', () => {
  beforeEach(() => {
    vi.stubEnv('MOBILE_APP_ORIGINS', APP)
    vi.stubEnv('APP_URL', 'http://localhost:3000')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('still rejects the app origin on ordinary web routes', async () => {
    const handler = ok()
    const res = await route({ auth: 'user' }, handler)(req('POST', { 'expo-origin': APP }))
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })
})
