/**
 * MA3-T01 route boundary: /api/m/v1/devices and /api/m/v1/push-preferences.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import * as authMod from '@/server/auth'
import { setupTestDb, testDb } from '../setup/db'
import { createEmployer, createStudent } from '../factories'
import { APP_ORIGIN, BROWSER_ORIGIN, appRequest, grantLegalConsent, readJson } from '../helpers/mobile-api'
import { clearSettingsCache } from '@/server/services/settings'
import { POST as registerDevice } from '@/app/api/m/v1/devices/route'
import { DELETE as deleteDevice } from '@/app/api/m/v1/devices/[id]/route'
import { GET as getPrefs, PATCH as patchPrefs } from '@/app/api/m/v1/push-preferences/route'

setupTestDb()

const fcmToken = () => `fcm-${randomUUID()}-${'x'.repeat(40)}`

async function signedInStudent() {
  const s = await createStudent(testDb)
  await grantLegalConsent(testDb, s.userId)
  const session = await testDb.session.create({ data: { userId: s.userId, token: randomUUID(), expiresAt: new Date(Date.now() + 86400_000) } })
  vi.mocked(authMod.getSession).mockResolvedValue({ user: { id: s.userId }, session: { id: session.id, createdAt: new Date() } } as never)
  return { ...s, sessionId: session.id }
}

beforeEach(() => {
  clearSettingsCache()
  vi.stubEnv('MOBILE_APP_ORIGINS', APP_ORIGIN)
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/m/v1/devices', () => {
  it('registers the token against the current session', async () => {
    const s = await signedInStudent()
    const res = await registerDevice(appRequest('/api/m/v1/devices', { body: { token: fcmToken(), appVersion: '0.1.0', locale: 'en' } }))
    expect(res.status).toBe(200)
    const { data } = await readJson(res)
    const row = await testDb.deviceToken.findUniqueOrThrow({ where: { id: data.id } })
    expect(row).toMatchObject({ userId: s.userId, sessionId: s.sessionId, locale: 'en', appVersion: '0.1.0' })
  })

  it('rejects browsers, employers, bad input and unknown fields', async () => {
    await signedInStudent()
    expect((await registerDevice(appRequest('/api/m/v1/devices', { body: { token: fcmToken(), locale: 'zh' }, headers: { origin: BROWSER_ORIGIN } }))).status).toBe(403)
    expect((await registerDevice(appRequest('/api/m/v1/devices', { body: { token: 'short', locale: 'zh' } }))).status).toBe(400)
    expect((await registerDevice(appRequest('/api/m/v1/devices', { body: { token: fcmToken(), locale: 'zh', userId: 'someone' } }))).status).toBe(400)
    const e = await createEmployer(testDb)
    vi.mocked(authMod.getSession).mockResolvedValue({ user: { id: e.userId }, session: { id: 's-emp', createdAt: new Date() } } as never)
    expect((await registerDevice(appRequest('/api/m/v1/devices', { body: { token: fcmToken(), locale: 'zh' } }))).status).toBe(403)
    expect(await testDb.deviceToken.count()).toBe(0)
  })
})

describe('DELETE /api/m/v1/devices/:id', () => {
  it('revokes only the caller’s own device', async () => {
    const a = await signedInStudent()
    const { data } = await readJson(await registerDevice(appRequest('/api/m/v1/devices', { body: { token: fcmToken(), locale: 'zh' } })))
    await signedInStudent() // 换成另一个学生
    expect((await deleteDevice(appRequest(`/api/m/v1/devices/${data.id}`, { method: 'DELETE' }))).status).toBe(404)
    vi.mocked(authMod.getSession).mockResolvedValue({ user: { id: a.userId }, session: { id: a.sessionId, createdAt: new Date() } } as never)
    expect((await deleteDevice(appRequest(`/api/m/v1/devices/${data.id}`, { method: 'DELETE' }))).status).toBe(200)
    expect((await testDb.deviceToken.findUniqueOrThrow({ where: { id: data.id } })).revokedAt).not.toBeNull()
    expect((await deleteDevice(appRequest('/api/m/v1/devices/not-a-cuid', { method: 'DELETE' }))).status).toBe(400)
  })
})

describe('/api/m/v1/push-preferences', () => {
  it('reads defaults and patches one category', async () => {
    await signedInStudent()
    expect((await readJson(await getPrefs(appRequest('/api/m/v1/push-preferences')))).data).toMatchObject({ applications: true, lockScreenDetails: false })
    const res = await patchPrefs(appRequest('/api/m/v1/push-preferences', { method: 'PATCH', body: { applications: false } }))
    expect((await readJson(res)).data).toMatchObject({ applications: false, invitations: true })
    expect((await patchPrefs(appRequest('/api/m/v1/push-preferences', { method: 'PATCH', body: { marketing: true } }))).status).toBe(400)
    expect((await getPrefs(appRequest('/api/m/v1/push-preferences', { headers: { origin: BROWSER_ORIGIN } }))).status).toBe(403)
  })
})
