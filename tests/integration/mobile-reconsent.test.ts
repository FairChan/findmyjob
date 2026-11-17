/**
 * MA1-T07：需要重新同意条款时，/api/m/v1 的登录态端点统一返回 409 NEEDS_RECONSENT；
 * 数据权利、隐私撤回、注销和同意本身的端点除外（与 proxy.ts 对 Web /s/privacy 的豁免一致）。
 * 表格覆盖 /api/m/v1 下的每一个路由方法；新增端点没登记进表格时，第一个用例会失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/lib/email', () => ({ createEmailProvider: () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }) }))
vi.mock('@/server/jobs/boss', () => ({
  sendBoss: { start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job') },
}))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { APP_ORIGIN, LEGAL_VERSION, appRequest, grantLegalConsent, mockSession, readJson } from '../helpers/mobile-api'
import { clearSettingsCache, setSetting } from '@/server/services/settings'

setupTestDb()

const ID = 'c' + '2'.repeat(24)
type Handler = (req: Request) => Promise<Response>
type Row = { file: string; method: string; path: string; body?: unknown; exempt: boolean; load: () => Promise<Handler> }

const ROWS: Row[] = [
  { file: 'me', method: 'GET', path: '/api/m/v1/me', exempt: true, load: () => import('@/app/api/m/v1/me/route').then((m) => m.GET) },
  { file: 'legal/reconsent', method: 'POST', path: '/api/m/v1/legal/reconsent', body: { agreed: true, version: 'stale-version' }, exempt: true, load: () => import('@/app/api/m/v1/legal/reconsent/route').then((m) => m.POST) },
  { file: 'privacy', method: 'GET', path: '/api/m/v1/privacy', exempt: true, load: () => import('@/app/api/m/v1/privacy/route').then((m) => m.GET) },
  { file: 'privacy', method: 'PUT', path: '/api/m/v1/privacy', body: { granted: false }, exempt: true, load: () => import('@/app/api/m/v1/privacy/route').then((m) => m.PUT) },
  { file: 'privacy/companies', method: 'GET', path: '/api/m/v1/privacy/companies?query=x', exempt: true, load: () => import('@/app/api/m/v1/privacy/companies/route').then((m) => m.GET) },
  { file: 'privacy/blocked-companies', method: 'POST', path: '/api/m/v1/privacy/blocked-companies', body: { companyId: ID }, exempt: true, load: () => import('@/app/api/m/v1/privacy/blocked-companies/route').then((m) => m.POST) },
  { file: 'privacy/blocked-companies/[companyId]', method: 'DELETE', path: `/api/m/v1/privacy/blocked-companies/${ID}`, exempt: true, load: () => import('@/app/api/m/v1/privacy/blocked-companies/[companyId]/route').then((m) => m.DELETE) },
  { file: 'data-requests/export', method: 'POST', path: '/api/m/v1/data-requests/export', body: {}, exempt: true, load: () => import('@/app/api/m/v1/data-requests/export/route').then((m) => m.POST) },
  { file: 'account/delete', method: 'POST', path: '/api/m/v1/account/delete', body: { confirm: true }, exempt: true, load: () => import('@/app/api/m/v1/account/delete/route').then((m) => m.POST) },
  { file: 'me/notification-prefs', method: 'GET', path: '/api/m/v1/me/notification-prefs', exempt: true, load: () => import('@/app/api/m/v1/me/notification-prefs/route').then((m) => m.GET) },
  { file: 'me/notification-prefs', method: 'PUT', path: '/api/m/v1/me/notification-prefs', body: { granted: false }, exempt: true, load: () => import('@/app/api/m/v1/me/notification-prefs/route').then((m) => m.PUT) },

  { file: 'me/locale', method: 'PATCH', path: '/api/m/v1/me/locale', body: { locale: 'en' }, exempt: false, load: () => import('@/app/api/m/v1/me/locale/route').then((m) => m.PATCH) },
  { file: 'profile', method: 'GET', path: '/api/m/v1/profile', exempt: false, load: () => import('@/app/api/m/v1/profile/route').then((m) => m.GET) },
  { file: 'profile/completeness', method: 'GET', path: '/api/m/v1/profile/completeness', exempt: false, load: () => import('@/app/api/m/v1/profile/completeness/route').then((m) => m.GET) },
  { file: 'profile/basic', method: 'PUT', path: '/api/m/v1/profile/basic', body: { fullName: 'Synthetic', workAuth: 'OTHER' }, exempt: false, load: () => import('@/app/api/m/v1/profile/basic/route').then((m) => m.PUT) },
  { file: 'profile/preferences', method: 'PUT', path: '/api/m/v1/profile/preferences', body: { intents: ['INTERNSHIP'] }, exempt: false, load: () => import('@/app/api/m/v1/profile/preferences/route').then((m) => m.PUT) },
  { file: 'profile/skills', method: 'PUT', path: '/api/m/v1/profile/skills', body: { languages: [], skills: [] }, exempt: false, load: () => import('@/app/api/m/v1/profile/skills/route').then((m) => m.PUT) },
  { file: 'profile/experience', method: 'PUT', path: '/api/m/v1/profile/experience', body: { educations: [], experiences: [] }, exempt: false, load: () => import('@/app/api/m/v1/profile/experience/route').then((m) => m.PUT) },
  { file: 'schools', method: 'GET', path: '/api/m/v1/schools', exempt: false, load: () => import('@/app/api/m/v1/schools/route').then((m) => m.GET) },
  { file: 'school-verification/send', method: 'POST', path: '/api/m/v1/school-verification/send', body: { schoolId: ID, schoolEmail: 'a@example.test' }, exempt: false, load: () => import('@/app/api/m/v1/school-verification/send/route').then((m) => m.POST) },
  { file: 'school-verification/confirm', method: 'POST', path: '/api/m/v1/school-verification/confirm', body: { otp: '123456' }, exempt: false, load: () => import('@/app/api/m/v1/school-verification/confirm/route').then((m) => m.POST) },
  { file: 'jobs', method: 'GET', path: '/api/m/v1/jobs', exempt: false, load: () => import('@/app/api/m/v1/jobs/route').then((m) => m.GET) },
  { file: 'jobs/[id]/preview', method: 'GET', path: `/api/m/v1/jobs/${ID}/preview`, exempt: false, load: () => import('@/app/api/m/v1/jobs/[id]/preview/route').then((m) => m.GET) },
  { file: 'jobs/[id]/open', method: 'POST', path: `/api/m/v1/jobs/${ID}/open`, exempt: false, load: () => import('@/app/api/m/v1/jobs/[id]/open/route').then((m) => m.POST) },
  { file: 'companies', method: 'GET', path: '/api/m/v1/companies', exempt: false, load: () => import('@/app/api/m/v1/companies/route').then((m) => m.GET) },
  { file: 'companies/[id]', method: 'GET', path: `/api/m/v1/companies/${ID}`, exempt: false, load: () => import('@/app/api/m/v1/companies/[id]/route').then((m) => m.GET) },
  { file: 'notifications', method: 'GET', path: '/api/m/v1/notifications', exempt: false, load: () => import('@/app/api/m/v1/notifications/route').then((m) => m.GET) },
  { file: 'notifications/read', method: 'POST', path: '/api/m/v1/notifications/read', body: { all: true }, exempt: false, load: () => import('@/app/api/m/v1/notifications/read/route').then((m) => m.POST) },
  { file: 'applications', method: 'GET', path: '/api/m/v1/applications', exempt: false, load: () => import('@/app/api/m/v1/applications/route').then((m) => m.GET) },
  { file: 'applications', method: 'POST', path: '/api/m/v1/applications', body: { jobId: ID }, exempt: false, load: () => import('@/app/api/m/v1/applications/route').then((m) => m.POST) },
  { file: 'applications/[id]/timeline', method: 'GET', path: `/api/m/v1/applications/${ID}/timeline`, exempt: false, load: () => import('@/app/api/m/v1/applications/[id]/timeline/route').then((m) => m.GET) },
  { file: 'applications/[id]/withdraw', method: 'POST', path: `/api/m/v1/applications/${ID}/withdraw`, exempt: false, load: () => import('@/app/api/m/v1/applications/[id]/withdraw/route').then((m) => m.POST) },
  { file: 'invitations', method: 'GET', path: '/api/m/v1/invitations', exempt: false, load: () => import('@/app/api/m/v1/invitations/route').then((m) => m.GET) },
  { file: 'invitations/[id]/accept', method: 'POST', path: `/api/m/v1/invitations/${ID}/accept`, exempt: false, load: () => import('@/app/api/m/v1/invitations/[id]/accept/route').then((m) => m.POST) },
  { file: 'invitations/[id]/decline', method: 'POST', path: `/api/m/v1/invitations/${ID}/decline`, exempt: false, load: () => import('@/app/api/m/v1/invitations/[id]/decline/route').then((m) => m.POST) },
  { file: 'referrals/me', method: 'GET', path: '/api/m/v1/referrals/me', exempt: false, load: () => import('@/app/api/m/v1/referrals/me/route').then((m) => m.GET) },
  // MA1-T08
  { file: 'resumes', method: 'GET', path: '/api/m/v1/resumes', exempt: false, load: () => import('@/app/api/m/v1/resumes/route').then((m) => m.GET) },
  { file: 'resumes/[id]/primary', method: 'POST', path: `/api/m/v1/resumes/${ID}/primary`, exempt: false, load: () => import('@/app/api/m/v1/resumes/[id]/primary/route').then((m) => m.POST) },
  { file: 'resumes/[id]', method: 'DELETE', path: `/api/m/v1/resumes/${ID}`, exempt: false, load: () => import('@/app/api/m/v1/resumes/[id]/route').then((m) => m.DELETE) },
  { file: 'contact', method: 'GET', path: '/api/m/v1/contact', exempt: false, load: () => import('@/app/api/m/v1/contact/route').then((m) => m.GET) },
  { file: 'contact', method: 'PUT', path: '/api/m/v1/contact', body: { email: 'me@example.test' }, exempt: false, load: () => import('@/app/api/m/v1/contact/route').then((m) => m.PUT) },
  { file: 'onboarding/complete', method: 'POST', path: '/api/m/v1/onboarding/complete', exempt: false, load: () => import('@/app/api/m/v1/onboarding/complete/route').then((m) => m.POST) },
  // MA3 的推送端点：注册设备和推送偏好照常检查；退出登录时注销设备必须可用，所以豁免
  { file: 'devices', method: 'POST', path: '/api/m/v1/devices', body: {}, exempt: false, load: () => import('@/app/api/m/v1/devices/route').then((m) => m.POST) },
  { file: 'devices/[id]', method: 'DELETE', path: `/api/m/v1/devices/${ID}`, exempt: true, load: () => import('@/app/api/m/v1/devices/[id]/route').then((m) => m.DELETE) },
  { file: 'push-preferences', method: 'GET', path: '/api/m/v1/push-preferences', exempt: false, load: () => import('@/app/api/m/v1/push-preferences/route').then((m) => m.GET) },
  { file: 'push-preferences', method: 'PATCH', path: '/api/m/v1/push-preferences', body: {}, exempt: false, load: () => import('@/app/api/m/v1/push-preferences/route').then((m) => m.PATCH) },
]

// 不需要登录、因此不检查同意的端点
const NOT_IN_TABLE = new Set(['config GET'])
const OUT_OF_SCOPE_PREFIXES: string[] = []

const V1 = path.resolve(__dirname, '../../src/app/api/m/v1')
function routeMethods(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return routeMethods(p)
    if (e.name !== 'route.ts') return []
    const rel = path.relative(V1, dir).replace(/\\/g, '/')
    const src = fs.readFileSync(p, 'utf8')
    return [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) =/g)].map((m) => `${rel} ${m[1]}`)
  })
}

function rowRequest(row: Row) {
  return appRequest(row.path, { method: row.method, ...(row.body !== undefined ? { body: row.body } : {}) })
}

beforeEach(async () => {
  clearSettingsCache()
  vi.stubEnv('MOBILE_APP_ORIGINS', APP_ORIGIN)
  await setSetting('legal.currentVersion', LEGAL_VERSION)
  clearSettingsCache()
})
afterEach(() => vi.unstubAllEnvs())

describe('NEEDS_RECONSENT on /api/m/v1', () => {
  it('the table covers every /api/m/v1 route method', () => {
    const actual = routeMethods(V1)
      .filter((k) => !NOT_IN_TABLE.has(k) && !OUT_OF_SCOPE_PREFIXES.some((p) => k.startsWith(p)))
      .sort()
    expect(actual).toEqual(ROWS.map((r) => `${r.file} ${r.method}`).sort())
  })

  for (const row of ROWS.filter((r) => !r.exempt)) {
    it(`${row.method} ${row.file}: 409 NEEDS_RECONSENT for a student who never consented`, async () => {
      const s = await createStudent(testDb)
      mockSession(s.userId)
      const res = await (await row.load())(rowRequest(row))
      expect(res.status).toBe(409)
      expect(await readJson(res)).toEqual({ ok: false, code: 'NEEDS_RECONSENT' })
      expect(res.headers.get('cache-control')).toBe('private, no-store')
    })
  }

  for (const row of ROWS.filter((r) => r.exempt)) {
    it(`${row.method} ${row.file}: exempt, reachable without new consent`, async () => {
      const s = await createStudent(testDb)
      await grantLegalConsent(testDb, s.userId, 'old-version')
      mockSession(s.userId)
      const res = await (await row.load())(rowRequest(row))
      // 豁免只是不检查同意；端点自己的业务结果照常（如 reconsent 带旧版本号会得到 409 VERSION_MISMATCH）
      expect((await readJson(res)).code).not.toBe('NEEDS_RECONSENT')
    })
  }

  it('consent under an old version, or a later revocation, still requires reconsent', async () => {
    const { GET } = await import('@/app/api/m/v1/profile/route')
    const s = await createStudent(testDb)
    mockSession(s.userId)
    await grantLegalConsent(testDb, s.userId, 'old-version')
    expect((await GET(appRequest('/api/m/v1/profile'))).status).toBe(409)
    await grantLegalConsent(testDb, s.userId)
    expect((await GET(appRequest('/api/m/v1/profile'))).status).toBe(200)
    await testDb.consent.create({ data: { userId: s.userId, type: 'PRIVACY', version: LEGAL_VERSION, granted: false } })
    expect((await GET(appRequest('/api/m/v1/profile'))).status).toBe(409)
  })

  it('POST /legal/reconsent with the current version unlocks the app; a stale version is VERSION_MISMATCH', async () => {
    const { POST } = await import('@/app/api/m/v1/legal/reconsent/route')
    const { GET } = await import('@/app/api/m/v1/jobs/route')
    const s = await createStudent(testDb)
    mockSession(s.userId)
    expect((await GET(appRequest('/api/m/v1/jobs'))).status).toBe(409)

    const stale = await POST(appRequest('/api/m/v1/legal/reconsent', { body: { agreed: true, version: 'old-version' } }))
    expect(stale.status).toBe(409)
    expect((await readJson(stale)).code).toBe('VERSION_MISMATCH')
    expect((await POST(appRequest('/api/m/v1/legal/reconsent', { body: { agreed: false, version: LEGAL_VERSION } }))).status).toBe(400)

    const ok = await POST(appRequest('/api/m/v1/legal/reconsent', {
      body: { agreed: true, version: LEGAL_VERSION }, headers: { 'x-real-ip': '203.0.113.7', 'user-agent': 'FindMYJob-Android/0.1.0' },
    }))
    expect(ok.status).toBe(200)
    const consents = await testDb.consent.findMany({ where: { userId: s.userId } })
    consents.sort((a, b) => a.type.localeCompare(b.type))
    expect(consents.map((c) => [c.type, c.version, c.granted, c.ip])).toEqual([
      ['PRIVACY', LEGAL_VERSION, true, '203.0.113.7'],
      ['TERMS', LEGAL_VERSION, true, '203.0.113.7'],
    ])
    const [audit] = await testDb.auditLog.findMany({ where: { action: 'user.reconsent' } })
    expect(audit.metadata).toEqual({ version: LEGAL_VERSION, client: 'android' })
    expect((await GET(appRequest('/api/m/v1/jobs'))).status).toBe(200)
  })

  it('an anonymous caller still gets 403 (auth first), not 409', async () => {
    const { GET } = await import('@/app/api/m/v1/profile/route')
    mockSession(null)
    expect((await GET(appRequest('/api/m/v1/profile'))).status).toBe(403)
  })

  it('web routes are unaffected: the upload endpoint does not check reconsent for browser requests', async () => {
    // route() 只对 origin 'app' 检查同意；Web 端的同意由 proxy.ts 在页面导航时处理
    const { route } = await import('@/server/route')
    const s = await createStudent(testDb)
    mockSession(s.userId)
    const handler = route({ auth: 'student' }, async () => Response.json({ ok: true, data: {} }))
    const res = await handler(new Request('http://localhost:3000/api/x', { headers: { origin: 'http://localhost:3000' } }))
    expect(res.status).toBe(200)
  })
})
