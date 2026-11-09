import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESUME_MAX_BYTES } from '@/server/lib/upload-constants'

const mocks = vi.hoisted(() => ({
  putObject: vi.fn(),
  deleteAllVersions: vi.fn(),
  createResume: vi.fn(),
  findStudent: vi.fn(),
  detectFileType: vi.fn(),
  checkPdf: vi.fn(),
  getSetting: vi.fn(),
  logAudit: vi.fn(),
  requireUser: vi.fn(),
  requireStudent: vi.fn(),
}))

vi.mock('@/lib/storage', () => ({
  putObject: mocks.putObject,
  deleteAllVersions: mocks.deleteAllVersions,
}))
vi.mock('@/server/db', () => ({
  db: {
    studentProfile: { findUnique: mocks.findStudent },
    resumeFile: { create: mocks.createResume },
  },
}))
vi.mock('@/server/authz', () => ({
  requireUser: mocks.requireUser,
  requireStudent: mocks.requireStudent,
}))
vi.mock('@/server/lib/pdf', () => ({
  detectFileType: mocks.detectFileType,
  checkPdf: mocks.checkPdf,
  MIME_TYPES: { pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg' },
}))
vi.mock('@/server/services/settings', () => ({ getSetting: mocks.getSetting }))
vi.mock('@/server/services/audit', () => ({ logAudit: mocks.logAudit }))
vi.mock('@/server/services/feature-flags', () => ({
  assertUploadsEnabled: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/server/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))
vi.mock('@/server/lib/logger', () => ({
  pinoOptions: {},
  logger: {
    fatal: vi.fn(), error: vi.fn(), warn: vi.fn(),
    info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
  },
}))

// Exercise the real route wrapper, including its error response and Origin check.
// Only infrastructure and the PDF validation boundary are mocked in this file.
import { POST } from '@/app/api/uploads/[purpose]/route'

const ORIGIN = 'https://uploads.example.test'

function requestResume(size?: number): Request {
  const bytes = size === undefined
    ? new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
    : new Uint8Array(size)
  const body = new FormData()
  body.set('file', new File([bytes], 'resume.pdf', { type: 'application/pdf' }))
  return new Request(ORIGIN + '/api/uploads/RESUME', {
    method: 'POST',
    headers: { Origin: ORIGIN },
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('APP_URL', ORIGIN)
  mocks.putObject.mockReset().mockResolvedValue(undefined)
  mocks.deleteAllVersions.mockReset().mockResolvedValue(undefined)
  mocks.createResume.mockReset().mockResolvedValue({ id: 'resume-01' })
  mocks.findStudent.mockReset().mockResolvedValue({ id: 'student-profile-01' })
  mocks.detectFileType.mockReset().mockReturnValue('pdf')
  mocks.checkPdf.mockReset().mockResolvedValue({ ok: true, pageCount: 2 })
  mocks.getSetting.mockReset().mockImplementation(async (_key: string, fallback: unknown) => fallback)
  mocks.logAudit.mockReset().mockResolvedValue(undefined)
  mocks.requireUser.mockReset().mockResolvedValue({ userId: 'student-user-01' })
  mocks.requireStudent.mockReset().mockResolvedValue({ userId: 'student-user-01' })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('RESUME upload persistence (M4-T17)', () => {
  it('deletes the exact uploaded object when ResumeFile insertion fails', async () => {
    mocks.createResume.mockRejectedValueOnce(new Error('private database failure'))

    const response = await POST(requestResume())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, code: 'INTERNAL_ERROR' })
    expect(mocks.putObject).toHaveBeenCalledOnce()
    const [key] = mocks.putObject.mock.calls[0]
    expect(key).toMatch(/^resumes\/student-profile-01\/[\w-]+\.pdf$/)
    expect(mocks.createResume).toHaveBeenCalledWith({
      data: expect.objectContaining({ studentId: 'student-profile-01', storageKey: key }),
    })
    expect(mocks.deleteAllVersions).toHaveBeenCalledExactlyOnceWith(key)
    expect(mocks.putObject.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createResume.mock.invocationCallOrder[0])
    expect(mocks.createResume.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.deleteAllVersions.mock.invocationCallOrder[0])
  })

  it('keeps a successfully persisted object and returns its resume id', async () => {
    const response = await POST(requestResume())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.putObject).toHaveBeenCalledOnce()
    expect(body).toEqual({
      ok: true,
      key: mocks.putObject.mock.calls[0][0],
      resumeId: 'resume-01',
    })
    expect(mocks.createResume).toHaveBeenCalledOnce()
    expect(mocks.deleteAllVersions).not.toHaveBeenCalled()
  })

  it('does not insert a row or issue compensation when putObject fails', async () => {
    mocks.putObject.mockRejectedValueOnce(new Error('private storage failure'))

    const response = await POST(requestResume())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, code: 'INTERNAL_ERROR' })
    expect(mocks.createResume).not.toHaveBeenCalled()
    expect(mocks.deleteAllVersions).not.toHaveBeenCalled()
  })

  it('still returns a generic failure when compensating deletion also fails', async () => {
    mocks.createResume.mockRejectedValueOnce(new Error('private database failure'))
    mocks.deleteAllVersions.mockRejectedValueOnce(new Error('private cleanup failure'))

    const response = await POST(requestResume())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, code: 'INTERNAL_ERROR' })
    expect(mocks.deleteAllVersions)
      .toHaveBeenCalledExactlyOnceWith(mocks.putObject.mock.calls[0][0])
  })
})

describe('RESUME upload rejection (M4-T17)', () => {
  it('rejects oversized input before PDF validation or object storage', async () => {
    const response = await POST(requestResume(RESUME_MAX_BYTES + 1))

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ ok: false, code: 'FILE_TOO_LARGE' })
    expect(mocks.detectFileType).not.toHaveBeenCalled()
    expect(mocks.checkPdf).not.toHaveBeenCalled()
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.createResume).not.toHaveBeenCalled()
    expect(mocks.deleteAllVersions).not.toHaveBeenCalled()
  })

  it('rejects a file whose declared PDF MIME type disagrees with detected bytes', async () => {
    mocks.detectFileType.mockReturnValueOnce(null)

    const response = await POST(requestResume())

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, code: 'INVALID_FILE_TYPE' })
    expect(mocks.checkPdf).not.toHaveBeenCalled()
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.createResume).not.toHaveBeenCalled()
    expect(mocks.deleteAllVersions).not.toHaveBeenCalled()
  })

  it.each([
    ['encrypted', 'ENCRYPTED_PDF'],
    ['too_many_pages', 'TOO_MANY_PAGES'],
    ['malformed', 'INVALID_PDF'],
  ])('rejects %s PDFs before persistence', async (reason, code) => {
    mocks.checkPdf.mockResolvedValueOnce({ ok: false, reason })

    const response = await POST(requestResume())

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, code })
    expect(mocks.checkPdf).toHaveBeenCalledWith(expect.any(Buffer), 20)
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'upload.reject',
      metadata: { reason, purpose: 'RESUME' },
    }))
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.createResume).not.toHaveBeenCalled()
    expect(mocks.deleteAllVersions).not.toHaveBeenCalled()
  })
})
