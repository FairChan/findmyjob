/**
 * Upload route authorization matrix tests (M2-T05).
 * Covers the authz-matrix gap for /api/uploads/[purpose].
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

// --- mocks ---

vi.mock('@/server/lib/logger', () => ({
  pinoOptions: {},
  logger: { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}))

const mockPutObject = vi.fn()
vi.mock('@/lib/storage', () => ({ putObject: mockPutObject }))

const mockLogAudit = vi.fn()
vi.mock('@/server/services/audit', () => ({ logAudit: mockLogAudit }))

vi.mock('@/server/services/settings', () => ({
  getSetting: vi.fn().mockResolvedValue(20),
}))

vi.mock('@/server/services/feature-flags', () => ({
  assertUploadsEnabled: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/server/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))

const mockDetectFileType = vi.fn().mockReturnValue('pdf')
vi.mock('@/server/lib/pdf', () => ({
  detectFileType: mockDetectFileType,
  checkPdf: vi.fn().mockResolvedValue({ ok: true, pageCount: 1 }),
  MIME_TYPES: { pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg' },
}))

vi.mock('@/server/db', () => ({
  db: {
    studentProfile: { findUnique: vi.fn().mockResolvedValue({ id: 'sp-01' }) },
    resumeFile: { create: vi.fn().mockResolvedValue({ id: 'rf-01' }) },
    paymentProofUpload: { create: vi.fn().mockResolvedValue({ id: 'proof-01' }) },
  },
}))

// requireStudent, requireCompanyMember, requireAdmin are set per-test below
const mockRequireStudent = vi.fn()
const mockRequireCompanyMember = vi.fn()
const mockRequireAdmin = vi.fn()
vi.mock('@/server/authz', () => ({
  requireStudent: mockRequireStudent,
  requireUser: vi.fn().mockResolvedValue({ userId: 'user-01' }),
  requireCompanyMember: mockRequireCompanyMember,
  requireAdmin: mockRequireAdmin,
}))

vi.mock('@/server/route', async () => {
  const actual = await vi.importActual<typeof import('@/server/route')>('@/server/route')
  return {
    ...actual,
    route: (opts: { auth: string }, handler: (req: Request, ctx: { userId?: string }) => Promise<Response>) =>
      (req: Request) => handler(req, { userId: 'user-01' }),
  }
})

const { POST } = await import('@/app/api/uploads/[purpose]/route')

function buildFormData(): FormData {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
  const file = new File([pdfBytes], 'test.pdf', { type: 'application/pdf' })
  const fd = new FormData()
  fd.set('file', file)
  return fd
}

function makeRequest(purpose: string): Request {
  return new Request(`http://localhost/api/uploads/${purpose}`, {
    method: 'POST',
    body: buildFormData(),
  })
}

describe('upload route authz matrix (M2-T05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPutObject.mockResolvedValue(undefined)
  })

  it('PAYMENT_PROOF: student (requireStudent throws) → 403 FORBIDDEN', async () => {
    mockRequireStudent.mockRejectedValue(new Error('forbidden'))
    mockRequireCompanyMember.mockRejectedValue(new Error('forbidden'))
    const res = await POST(makeRequest('PAYMENT_PROOF'))
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  it('PAYMENT_PROOF: ADMIN role (requireCompanyMember OWNER throws) → 403 FORBIDDEN', async () => {
    // requireCompanyMember('OWNER') throws for an ADMIN user
    mockRequireCompanyMember.mockRejectedValue(new Error('forbidden'))
    const res = await POST(makeRequest('PAYMENT_PROOF'))
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  it('PAYMENT_PROOF: OWNER role → passes authz (proceeds to file checks)', async () => {
    mockRequireCompanyMember.mockResolvedValue({ companyId: 'co-01' })
    const res = await POST(makeRequest('PAYMENT_PROOF'))
    // requireCompanyMember was called with 'OWNER' (not 'ADMIN')
    expect(mockRequireCompanyMember).toHaveBeenCalledWith('OWNER', expect.anything())
    // Authz passed; storage was called
    expect(mockPutObject).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
  })

  it('LOGO: ADMIN role → passes authz (requireCompanyMember called with ADMIN)', async () => {
    mockRequireCompanyMember.mockResolvedValue({ companyId: 'co-01' })
    // LOGO accepts png/jpeg — override mock so the file type check passes
    mockDetectFileType.mockReturnValueOnce('png')
    const res = await POST(makeRequest('LOGO'))
    expect(mockRequireCompanyMember).toHaveBeenCalledWith('ADMIN', expect.anything())
    expect(res.status).toBe(200)
  })

  it('VERIFICATION: ADMIN role → passes authz (requireCompanyMember called with ADMIN)', async () => {
    mockRequireCompanyMember.mockResolvedValue({ companyId: 'co-01' })
    const res = await POST(makeRequest('VERIFICATION'))
    expect(mockRequireCompanyMember).toHaveBeenCalledWith('ADMIN', expect.anything())
    expect(res.status).toBe(200)
  })

  it('RESUME: student → passes authz (requireStudent called)', async () => {
    mockRequireStudent.mockResolvedValue({ userId: 'user-01' })
    const res = await POST(makeRequest('RESUME'))
    expect(mockRequireStudent).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
  })

  it('invalid purpose → 400 BAD_REQUEST (not 404)', async () => {
    const res = await POST(makeRequest('INVALID_PURPOSE'))
    expect(res.status).toBe(400)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_PURPOSE')
  })
})

// --- PARTNER_LOGO auth and validation tests (M6-T11) ---

function makeOversizeRequest(purpose: string): Request {
  // 3 MB + 1 byte — exceeds the PARTNER_LOGO 2 MB cap
  const bytes = new Uint8Array(3 * 1024 * 1024 + 1)
  const file = new File([bytes], 'big.png', { type: 'image/png' })
  const fd = new FormData()
  fd.set('file', file)
  return new Request(`http://localhost/api/uploads/${purpose}`, {
    method: 'POST',
    body: fd,
  })
}

describe('PARTNER_LOGO upload route (M6-T11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPutObject.mockResolvedValue(undefined)
    // Default: requireAdmin throws → 403
    mockRequireAdmin.mockRejectedValue(new Error('forbidden'))
  })

  it('student (requireAdmin throws) → 403, putObject not called', async () => {
    const res = await POST(makeRequest('PARTNER_LOGO'))
    expect(res.status).toBe(403)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FORBIDDEN')
    expect(mockPutObject).not.toHaveBeenCalled()
  })

  it('employer (requireAdmin throws) → 403, putObject not called', async () => {
    // requireCompanyMember would succeed for an employer, but requireAdmin still throws
    mockRequireCompanyMember.mockResolvedValue({ companyId: 'co-01' })
    const res = await POST(makeRequest('PARTNER_LOGO'))
    expect(res.status).toBe(403)
    expect(mockPutObject).not.toHaveBeenCalled()
  })

  it('admin + file > 2 MB → 413, putObject not called', async () => {
    mockRequireAdmin.mockResolvedValue(undefined)
    const res = await POST(makeOversizeRequest('PARTNER_LOGO'))
    expect(res.status).toBe(413)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('FILE_TOO_LARGE')
    expect(mockPutObject).not.toHaveBeenCalled()
  })

  it('admin + SVG content (unrecognised magic bytes) → 400 INVALID_FILE_TYPE, putObject not called', async () => {
    mockRequireAdmin.mockResolvedValue(undefined)
    // SVG starts with text — detectFileType returns null
    mockDetectFileType.mockReturnValueOnce(null)
    const res = await POST(makeRequest('PARTNER_LOGO'))
    expect(res.status).toBe(400)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('INVALID_FILE_TYPE')
    expect(mockPutObject).not.toHaveBeenCalled()
  })

  it('admin + valid PNG → 200, putObject called once', async () => {
    mockRequireAdmin.mockResolvedValue(undefined)
    mockDetectFileType.mockReturnValueOnce('png')
    const res = await POST(makeRequest('PARTNER_LOGO'))
    expect(res.status).toBe(200)
    expect(mockPutObject).toHaveBeenCalledOnce()
    const body = await res.json() as { ok: boolean; key: string }
    expect(body.ok).toBe(true)
    expect(body.key).toMatch(/^partner-logos\//)
  })
})
