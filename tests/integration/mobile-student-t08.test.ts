/**
 * MA1-T08：App 还缺的学生端端点——简历列表/设主简历/删除、本人联系方式读写、完成新手引导。
 * 全部复用 Web 的 service；联系方式只经 contact-access（红线）。
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/lib/storage', () => ({
  deleteAllVersions: vi.fn().mockResolvedValue(undefined),
  putObject: vi.fn().mockResolvedValue(undefined),
  getSignedDownloadUrl: vi.fn(),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import { seedApplicationMaterials } from '../helpers/application-materials'
import { APP_ORIGIN, BROWSER_ORIGIN, appRequest, grantLegalConsent, mockSession, readJson } from '../helpers/mobile-api'
import { deleteAllVersions } from '@/lib/storage'
import { clearSettingsCache } from '@/server/services/settings'
import { mobileContactSchema, mobileResumeListSchema } from '@/shared/mobile-api'
import { GET as listResumes } from '@/app/api/m/v1/resumes/route'
import { POST as setPrimary } from '@/app/api/m/v1/resumes/[id]/primary/route'
import { DELETE as deleteResume } from '@/app/api/m/v1/resumes/[id]/route'
import { GET as getContact, PUT as putContact } from '@/app/api/m/v1/contact/route'
import { POST as completeOnboarding } from '@/app/api/m/v1/onboarding/complete/route'

setupTestDb()

const ID = 'c' + '3'.repeat(24)

beforeEach(() => {
  clearSettingsCache()
  vi.stubEnv('MOBILE_APP_ORIGINS', APP_ORIGIN)
  vi.mocked(deleteAllVersions).mockClear()
})
afterEach(() => vi.unstubAllEnvs())

async function student() {
  const s = await createStudent(testDb)
  await grantLegalConsent(testDb, s.userId)
  mockSession(s.userId)
  return s
}

async function resume(studentId: string, name: string, isPrimary = false) {
  return testDb.resumeFile.create({
    data: { studentId, fileName: name, storageKey: `resumes/${studentId}/${name}`, mimeType: 'application/pdf', sizeBytes: 1234, pageCount: 2, isPrimary },
  })
}

type Handler = (req: Request) => Promise<Response>
type Row = { name: string; handler: Handler; method: string; path: string; body?: unknown; bad?: { path?: string; body?: unknown } }
const ROWS: Row[] = [
  { name: 'GET /resumes', handler: listResumes, method: 'GET', path: '/api/m/v1/resumes' },
  { name: 'POST /resumes/:id/primary', handler: setPrimary, method: 'POST', path: `/api/m/v1/resumes/${ID}/primary`, bad: { path: '/api/m/v1/resumes/bad/primary' } },
  { name: 'DELETE /resumes/:id', handler: deleteResume, method: 'DELETE', path: `/api/m/v1/resumes/${ID}`, bad: { path: '/api/m/v1/resumes/bad' } },
  { name: 'GET /contact', handler: getContact, method: 'GET', path: '/api/m/v1/contact' },
  { name: 'PUT /contact', handler: putContact, method: 'PUT', path: '/api/m/v1/contact', body: { email: 'me@example.test' }, bad: { body: { phone: 'not-a-phone' } } },
  { name: 'POST /onboarding/complete', handler: completeOnboarding, method: 'POST', path: '/api/m/v1/onboarding/complete' },
]

function req(row: Row, o: { path?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const body = 'body' in o ? o.body : row.body
  return appRequest(o.path ?? row.path, { method: row.method, ...(body !== undefined ? { body } : {}), headers: o.headers })
}

describe('MA1-T08 route boundary', () => {
  for (const row of ROWS) {
    it(`${row.name}: anonymous / employer / browser origin / look-alike scheme are 403`, async () => {
      mockSession(null)
      expect((await row.handler(req(row))).status).toBe(403)
      const e = await createEmployer(testDb)
      await grantLegalConsent(testDb, e.userId)
      mockSession(e.userId)
      expect((await row.handler(req(row))).status).toBe(403)
      await student()
      expect((await row.handler(req(row, { headers: { origin: BROWSER_ORIGIN } }))).status).toBe(403)
      expect((await row.handler(req(row, { headers: { 'expo-origin': 'findmyjob-dev-evil://' } }))).status).toBe(403)
      expect(await testDb.studentContact.count()).toBe(0)
    })
  }
  for (const row of ROWS.filter((r) => r.bad)) {
    it(`${row.name}: invalid input is 400 VALIDATION_ERROR`, async () => {
      await student()
      const res = await row.handler(req(row, row.bad))
      expect(res.status).toBe(400)
      expect((await readJson(res)).code).toBe('VALIDATION_ERROR')
    })
  }
  it('PUT /contact: malformed JSON is 400 INVALID_JSON', async () => {
    await student()
    const res = await putContact(appRequest('/api/m/v1/contact', { method: 'PUT', rawBody: '{oops' }))
    expect((await readJson(res)).code).toBe('INVALID_JSON')
  })
})

describe('resumes', () => {
  it('lists only own resumes in the shape the App parses, primary first, without storage keys', async () => {
    const s = await student()
    const other = await createStudent(testDb)
    await resume(s.profileId, 'b.pdf')
    await resume(s.profileId, 'a.pdf', true)
    await resume(other.profileId, 'theirs.pdf', true)
    const raw = (await readJson(await listResumes(appRequest('/api/m/v1/resumes')))).data
    const list = mobileResumeListSchema.parse(raw)
    expect(list.items.map((r) => r.fileName)).toEqual(['a.pdf', 'b.pdf'])
    expect(list.items[0]).toMatchObject({ isPrimary: true, pageCount: 2, sizeBytes: 1234 })
    expect(JSON.stringify(raw)).not.toMatch(/storageKey|resumes\//)
  })

  it('sets the primary resume; another student’s resume is 403 and unchanged', async () => {
    const s = await student()
    const a = await resume(s.profileId, 'a.pdf', true)
    const b = await resume(s.profileId, 'b.pdf')
    const other = await createStudent(testDb)
    const theirs = await resume(other.profileId, 'theirs.pdf')
    expect((await setPrimary(appRequest(`/api/m/v1/resumes/${b.id}/primary`, { method: 'POST' }))).status).toBe(200)
    expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: a.id } })).isPrimary).toBe(false)
    expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: b.id } })).isPrimary).toBe(true)
    expect((await setPrimary(appRequest(`/api/m/v1/resumes/${theirs.id}/primary`, { method: 'POST' }))).status).toBe(403)
    expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: theirs.id } })).isPrimary).toBe(false)
    expect((await setPrimary(appRequest(`/api/m/v1/resumes/${ID}/primary`, { method: 'POST' }))).status).toBe(404)
  })

  it('deletes an own resume and cleans storage after commit; another student’s is 403 and kept', async () => {
    const s = await student()
    const mine = await resume(s.profileId, 'mine.pdf', true)
    const other = await createStudent(testDb)
    const theirs = await resume(other.profileId, 'theirs.pdf')
    expect((await deleteResume(appRequest(`/api/m/v1/resumes/${theirs.id}`, { method: 'DELETE' }))).status).toBe(403)
    expect(await testDb.resumeFile.count({ where: { id: theirs.id } })).toBe(1)
    expect(vi.mocked(deleteAllVersions)).not.toHaveBeenCalled()

    expect((await deleteResume(appRequest(`/api/m/v1/resumes/${mine.id}`, { method: 'DELETE' }))).status).toBe(200)
    expect(await testDb.resumeFile.count({ where: { id: mine.id } })).toBe(0)
    expect(vi.mocked(deleteAllVersions)).toHaveBeenCalledExactlyOnceWith(mine.storageKey)
  })
})

describe('own contact', () => {
  it('reads and writes only the caller’s contact, encrypted at rest, normalized like the web', async () => {
    const other = await createStudent(testDb)
    await seedApplicationMaterials(testDb, other.profileId) // 另一名学生有联系方式 applicant@example.test
    const s = await student()
    expect(mobileContactSchema.parse((await readJson(await getContact(appRequest('/api/m/v1/contact')))).data))
      .toEqual({ phone: null, email: null, whatsapp: null, wechat: null, linkedinUrl: null })

    const put = await putContact(appRequest('/api/m/v1/contact', {
      method: 'PUT', body: { phone: '012-345 6789', email: 'synthetic.me@example.test', linkedinUrl: 'https://www.linkedin.com/in/synthetic' },
    }))
    expect(put.status).toBe(200)
    const saved = mobileContactSchema.parse((await readJson(put)).data)
    expect(saved).toEqual({ phone: '+60123456789', email: 'synthetic.me@example.test', whatsapp: null, wechat: null, linkedinUrl: 'https://www.linkedin.com/in/synthetic' })

    const row = await testDb.studentContact.findUniqueOrThrow({ where: { studentId: s.profileId } })
    expect(JSON.stringify(row)).not.toContain('synthetic.me@example.test')
    expect(JSON.stringify(row)).not.toContain('+60123456789')

    const again = JSON.stringify((await readJson(await getContact(appRequest('/api/m/v1/contact')))).data)
    expect(again).not.toContain('applicant@example.test')
    expect((await testDb.studentProfile.findUniqueOrThrow({ where: { id: s.profileId } })).completeness).toBeGreaterThanOrEqual(0)

    // 整份提交：没带的字段被清空（与 Web 表单相同）
    await putContact(appRequest('/api/m/v1/contact', { method: 'PUT', body: { wechat: 'synthetic_wx' } }))
    expect(mobileContactSchema.parse((await readJson(await getContact(appRequest('/api/m/v1/contact')))).data))
      .toEqual({ phone: null, email: null, whatsapp: null, wechat: 'synthetic_wx', linkedinUrl: null })
  })

  it('rejects a non-LinkedIn profile URL like the web form', async () => {
    await student()
    const res = await putContact(appRequest('/api/m/v1/contact', { method: 'PUT', body: { linkedinUrl: 'https://evil.example.test/x' } }))
    expect(res.status).toBe(400)
    expect(await testDb.studentContact.count()).toBe(0)
  })
})

describe('POST /onboarding/complete', () => {
  it('requires the profile steps, then contact and resume, then completes', async () => {
    const s = await student()
    expect((await completeOnboarding(appRequest('/api/m/v1/onboarding/complete', { method: 'POST' }))).status).toBe(422)
    await testDb.studentProfile.update({ where: { id: s.profileId }, data: { onboardingStep: 5 } })
    expect((await readJson(await completeOnboarding(appRequest('/api/m/v1/onboarding/complete', { method: 'POST' })))).code).toBe('CONTACT_REQUIRED')
    await seedApplicationMaterials(testDb, s.profileId)
    expect((await completeOnboarding(appRequest('/api/m/v1/onboarding/complete', { method: 'POST' }))).status).toBe(200)
    expect((await testDb.studentProfile.findUniqueOrThrow({ where: { id: s.profileId } })).onboardingStep).toBe(6)
  })
})
