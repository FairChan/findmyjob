import { vi, describe, it, expect, beforeEach } from 'vitest'

// --- mock infrastructure ---

vi.mock('@/server/lib/logger', () => ({
  pinoOptions: {},
  logger: { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}))

const mockPutObject = vi.fn()
vi.mock('@/lib/storage', () => ({ putObject: mockPutObject }))

const mockLogAudit = vi.fn()
vi.mock('@/server/services/audit', () => ({ logAudit: mockLogAudit }))
vi.mock('@/server/services/student-profile', () => ({ recalcMatchingEligibilityTx: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/server/services/settings', () => ({
  getSetting: vi.fn().mockResolvedValue(20),
}))

vi.mock('@/server/services/feature-flags', () => ({
  assertUploadsEnabled: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/server/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))

// stub authz — requireStudent passes by default
vi.mock('@/server/authz', () => ({
  requireStudent: vi.fn().mockResolvedValue({ userId: 'user-test-01' }),
  requireUser: vi.fn().mockResolvedValue({ userId: 'user-test-01' }),
  requireCompanyMember: vi.fn().mockResolvedValue({ companyId: 'co-01' }),
}))

// stub route() auth resolution — auth:'user' just injects userId
vi.mock('@/server/route', async () => {
  const actual = await vi.importActual<typeof import('@/server/route')>('@/server/route')
  return {
    ...actual,
    route: (opts: { auth: string }, handler: (req: Request, ctx: { userId?: string }) => Promise<Response>) =>
      (req: Request) => handler(req, { userId: 'user-test-01' }),
  }
})

// stub pdf detection to return a valid PDF
vi.mock('@/server/lib/pdf', () => ({
  detectFileType: vi.fn().mockReturnValue('pdf'),
  checkPdf: vi.fn().mockResolvedValue({ ok: true, pageCount: 1 }),
  MIME_TYPES: { pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg' },
}))

// stub db — studentProfile found
const mockResumeFileCreate = vi.fn().mockResolvedValue({ id: 'rf-01' })
vi.mock('@/server/db', () => {
  const db = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    user: { findUnique: vi.fn().mockResolvedValue({ role: 'STUDENT', status: 'ACTIVE' }) },
    studentProfile: { findUnique: vi.fn().mockResolvedValue({ id: 'sp-01', userId: 'user-test-01' }) },
    resumeFile: { create: mockResumeFileCreate },
  }
  return { db: { ...db, $transaction: vi.fn(async (work: (tx: typeof db) => Promise<unknown>) => work(db)) } }
})

const { POST } = await import('@/app/api/uploads/[purpose]/route')

function buildFormData(fileName: string): FormData {
  // minimal valid PDF magic bytes
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
  const file = new File([pdfBytes], fileName, { type: 'application/pdf' })
  const fd = new FormData()
  fd.set('file', file)
  return fd
}

function makeRequest(fileName: string): Request {
  return new Request('http://localhost/api/uploads/RESUME', {
    method: 'POST',
    body: buildFormData(fileName),
  })
}

describe('POST /api/uploads/[purpose] — filename validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPutObject.mockResolvedValue(undefined)
    mockResumeFileCreate.mockResolvedValue({ id: 'rf-01' })
  })

  it('rejects a filename longer than 255 chars with 400 and does not call putObject', async () => {
    const longName = 'a'.repeat(256) + '.pdf'
    const res = await POST(makeRequest(longName))

    expect(res.status).toBe(400)
    expect(mockPutObject).not.toHaveBeenCalled()

    const body = await res.json() as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('INVALID_FILE_NAME')
  })

  it('writes upload.reject audit with reason invalid_file_name for oversized filename', async () => {
    const longName = 'a'.repeat(256) + '.pdf'
    await POST(makeRequest(longName))

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'upload.reject',
        metadata: expect.objectContaining({ reason: 'invalid_file_name' }),
      }),
    )
  })

  it('rejects a whitespace-only filename', async () => {
    const res = await POST(makeRequest('   '))
    expect(res.status).toBe(400)
    expect(mockPutObject).not.toHaveBeenCalled()
  })

  it('accepts a valid 255-char filename and calls putObject', async () => {
    const okName = 'a'.repeat(251) + '.pdf'
    const res = await POST(makeRequest(okName))
    expect(mockPutObject).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
  })
})
