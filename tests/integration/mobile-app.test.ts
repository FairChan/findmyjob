/**
 * MA1-T04 (first endpoints): /api/m/v1/config and /api/m/v1/me services, plus the route
 * boundary through the real route() wrapper with a mocked session.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import * as authMod from '@/server/auth'
import { clearSettingsCache, setSetting } from '@/server/services/settings'
import { getMobileConfig, getMobileMe } from '@/server/services/mobile-app'
import { mobileConfigSchema, mobileMeSchema } from '@/shared/mobile-api'
import { GET as getMe } from '@/app/api/m/v1/me/route'
import { GET as getConfig } from '@/app/api/m/v1/config/route'

setupTestDb()

const APP = 'findmyjob-dev://'

function mockSession(userId: string | null) {
  vi.mocked(authMod.getSession).mockResolvedValue(
    userId ? ({ user: { id: userId }, session: { id: 's1', createdAt: new Date() } } as never) : null,
  )
}

function appRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    headers: { 'expo-origin': APP, 'x-app-version': '0.1.0', ...headers },
  })
}

beforeEach(() => {
  clearSettingsCache()
  vi.stubEnv('MOBILE_APP_ORIGINS', APP)
})
afterEach(() => vi.unstubAllEnvs())

describe('getMobileConfig', () => {
  it('returns defaults and follows settings', async () => {
    expect(mobileConfigSchema.parse(await getMobileConfig()).minSupportedVersion).toBe('0.0.0')
    await setSetting('mobile.minSupportedVersion', '0.3.0')
    await setSetting('mobile.latestVersion', '0.4.0')
    clearSettingsCache()
    const cfg = await getMobileConfig()
    expect(cfg.minSupportedVersion).toBe('0.3.0')
    expect(cfg.latestVersion).toBe('0.4.0')
    expect(Object.keys(cfg).sort()).toEqual(['latestVersion', 'legalVersion', 'minSupportedVersion'])
  })
})

describe('getMobileMe', () => {
  it('returns only the caller’s own basic fields', async () => {
    const s = await createStudent(testDb)
    const me = await getMobileMe({ userId: s.userId })
    expect(mobileMeSchema.parse(me).id).toBe(s.userId)
    expect(me.role).toBe('STUDENT')
    expect(Object.keys(me).sort()).toEqual(['email', 'emailVerified', 'id', 'locale', 'name', 'role'])
  })
})

describe('GET /api/m/v1/me (route boundary)', () => {
  it('serves the signed-in student from the app origin', async () => {
    const s = await createStudent(testDb)
    mockSession(s.userId)
    const res = await getMe(appRequest('/api/m/v1/me'))
    expect(res.status).toBe(200)
    expect((await res.json()).data.id).toBe(s.userId)
  })

  it('serves an employer too (role decides the app shell)', async () => {
    const e = await createEmployer(testDb)
    mockSession(e.userId)
    const res = await getMe(appRequest('/api/m/v1/me'))
    expect((await res.json()).data.role).toBe('EMPLOYER')
  })

  it('rejects anonymous callers and suspended users', async () => {
    // Without a cookie proxy.ts answers 401 first; with a stale cookie authz answers 403 FORBIDDEN,
    // so the app re-checks get-session on 401/403 before signing out (MA2-T02).
    mockSession(null)
    expect((await getMe(appRequest('/api/m/v1/me'))).status).toBe(403)
    const s = await createStudent(testDb)
    await testDb.user.update({ where: { id: s.userId }, data: { status: 'SUSPENDED' } })
    mockSession(s.userId)
    expect([401, 403]).toContain((await getMe(appRequest('/api/m/v1/me'))).status)
  })

  it('rejects a browser origin even with a valid session', async () => {
    const s = await createStudent(testDb)
    mockSession(s.userId)
    const res = await getMe(appRequest('/api/m/v1/me', { origin: 'http://localhost:3000' }))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/m/v1/config (route boundary)', () => {
  it('is public for the app and closed to browsers', async () => {
    mockSession(null)
    expect((await getConfig(appRequest('/api/m/v1/config'))).status).toBe(200)
    expect((await getConfig(appRequest('/api/m/v1/config', { origin: 'http://localhost:3000' }))).status).toBe(403)
  })
})
