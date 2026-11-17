/**
 * MA1-T06：/api/uploads/[purpose] 用 route({ origin: 'web+app' }) 接受 Android App。
 * App 请求过 origin 和版本门控之后，校验逻辑与 Web 完全相同；被拒绝的上传照样写 upload.reject 审计，
 * 而且带 client: 'android'。
 */
import { PDFDocument } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock('@/server/jobs/boss', () => ({
  sendBoss: { start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job') },
}))
vi.mock('@/lib/storage', () => ({
  putObject: vi.fn().mockResolvedValue(undefined),
  deleteAllVersions: vi.fn().mockResolvedValue(undefined),
  getObjectBytes: vi.fn(),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer, createStudent } from '../factories'
import { APP_ORIGIN, mockSession } from '../helpers/mobile-api'
import { putObject } from '@/lib/storage'
import { clearSettingsCache, setSetting } from '@/server/services/settings'
import { POST } from '@/app/api/uploads/[purpose]/route'

setupTestDb()

const WEB_ORIGIN = 'https://mobile-upload.example.test'

async function pdfForm() {
  const pdf = await PDFDocument.create()
  pdf.addPage().drawText('Synthetic mobile upload document.')
  const form = new FormData()
  form.set('file', new File([new Uint8Array(await pdf.save())], 'synthetic-resume.pdf', { type: 'application/pdf' }))
  return form
}

function upload(form: FormData, headers: Record<string, string>, purpose = 'RESUME') {
  return POST(new Request(`${WEB_ORIGIN}/api/uploads/${purpose}`, { method: 'POST', headers, body: form }))
}

const appHeaders = { 'expo-origin': APP_ORIGIN, 'x-app-version': '0.1.0' }

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache()
  vi.stubEnv('APP_URL', WEB_ORIGIN)
  vi.stubEnv('MOBILE_APP_ORIGINS', APP_ORIGIN)
  vi.mocked(putObject).mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('uploads accept the Android app origin (MA1-T06)', () => {
  it('a student uploads a resume from the app, same as from the web', async () => {
    const s = await createStudent(testDb)
    mockSession(s.userId)
    const fromApp = await upload(await pdfForm(), appHeaders)
    expect(fromApp.status).toBe(200)
    const fromAppOrigin = await upload(await pdfForm(), { origin: APP_ORIGIN, 'x-app-version': '0.1.0' })
    expect(fromAppOrigin.status).toBe(200)
    const fromWeb = await upload(await pdfForm(), { origin: WEB_ORIGIN })
    expect(fromWeb.status).toBe(200)
    expect(fromApp.headers.get('cache-control')).toBe('private, no-store')
    expect(await testDb.resumeFile.count({ where: { studentId: s.profileId } })).toBe(3)
    expect(vi.mocked(putObject)).toHaveBeenCalledTimes(3)
  })

  it('validation is unchanged for the app: a non-PDF is rejected and audited with client android', async () => {
    const s = await createStudent(testDb)
    mockSession(s.userId)
    const form = new FormData()
    form.set('file', new File([new TextEncoder().encode('<html>not a pdf</html>')], 'fake.pdf', { type: 'application/pdf' }))
    const res = await upload(form, appHeaders)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(await testDb.resumeFile.count()).toBe(0)
    const audits = await testDb.auditLog.findMany({ where: { action: 'upload.reject', actorId: s.userId } })
    expect(audits).toHaveLength(1)
    expect(audits[0].metadata).toMatchObject({ purpose: 'RESUME', client: 'android' })
  })

  it('role checks are unchanged: an employer cannot upload a resume from the app', async () => {
    const e = await createEmployer(testDb)
    mockSession(e.userId)
    expect((await upload(await pdfForm(), appHeaders)).status).toBe(403)
    expect(await testDb.resumeFile.count()).toBe(0)
  })

  it('rejects look-alike schemes, missing origins and outdated app versions', async () => {
    const s = await createStudent(testDb)
    mockSession(s.userId)
    expect((await upload(await pdfForm(), { 'expo-origin': 'findmyjob-dev-evil://', 'x-app-version': '0.1.0' })).status).toBe(403)
    expect((await upload(await pdfForm(), {})).status).toBe(403)
    expect((await upload(await pdfForm(), { origin: 'https://evil.example.test' })).status).toBe(403)
    await setSetting('mobile.minSupportedVersion', '0.2.0')
    clearSettingsCache()
    expect((await upload(await pdfForm(), appHeaders)).status).toBe(426)
    // 浏览器不受 App 版本门控影响
    expect((await upload(await pdfForm(), { origin: WEB_ORIGIN })).status).toBe(200)
    expect(await testDb.resumeFile.count()).toBe(1)
  })

  it('rejects the app origin when MOBILE_APP_ORIGINS is not configured', async () => {
    vi.stubEnv('MOBILE_APP_ORIGINS', '')
    const s = await createStudent(testDb)
    mockSession(s.userId)
    expect((await upload(await pdfForm(), appHeaders)).status).toBe(403)
  })
})
