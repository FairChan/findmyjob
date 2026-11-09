import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  session: vi.fn(), user: vi.fn(), member: vi.fn(), download: vi.fn(), error: vi.fn(),
}))
vi.mock('@/server/auth', () => ({ getSession: io.session, auth: {} }))
vi.mock('@/server/db', () => ({ db: {
  user: { findUnique: io.user }, companyMember: { findFirst: io.member },
} }))
vi.mock('@/server/services/invoice-delivery', () => ({ getInvoiceDownload: io.download }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: io.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

// Execute the real route wrapper and authz functions. Session/DB/delivery are their
// external ports; this isolates the route's post-I/O session check and header boundary.
import { GET } from '@/app/api/invoices/[id]/download/route'

const invoiceId = 'c' + '1'.repeat(24)
const companyId = 'c' + '2'.repeat(24)
const ownerId = 'c' + '3'.repeat(24)
const replacementId = 'c' + '4'.repeat(24)
const pdf = Buffer.from('%PDF-1.7\nPRIVATE_SYNTHETIC_INVOICE_BODY')
const validResult = () => ({ bytes: pdf, invoiceNo: 'FMJ-INV-00000001' })

function session(userId: string | null) {
  io.session.mockResolvedValue(userId === null ? null : {
    user: { id: userId },
    session: { id: 'synthetic-session', userId, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
  })
}
function request(signal?: AbortSignal) {
  return new Request(`http://localhost/api/invoices/${invoiceId}/download`, {
    headers: { cookie: 'synthetic-session-only' }, signal,
  })
}
function privateHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  expect(response.headers.get('location')).toBeNull()
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status)
  privateHeaders(response)
  expect(response.headers.get('content-disposition')).toBeNull()
  expect(response.headers.get('content-type')).toBe('application/json')
  expect(await response.json()).toEqual({ ok: false, code })
  expect(io.error).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
  session(ownerId)
  io.user.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id, role: 'EMPLOYER', status: 'ACTIVE', twoFactorEnabled: false,
  }))
  io.member.mockImplementation(async ({ where }: { where: { userId: string } }) => ({
    userId: where.userId, companyId, role: 'OWNER', company: { id: companyId, isActive: true },
  }))
  io.download.mockResolvedValue(validResult())
})

describe('T05 route session and filename boundaries', () => {
  it.each(['revoked', 'different-owner'] as const)(
    'withholds PDF bytes when the session is %s after download I/O', async change => {
      io.download.mockImplementationOnce(async () => {
        await Promise.resolve()
        session(change === 'revoked' ? null : replacementId)
        return validResult()
      })
      const req = request()
      await failure(await GET(req), 403, 'FORBIDDEN')
      expect(io.download).toHaveBeenCalledExactlyOnceWith({ userId: ownerId }, invoiceId)
      // A replacement is also a current ACTIVE OWNER of the same company. The
      // route must compare identity, not merely repeat a role/active-state check.
      expect(io.session).toHaveBeenCalledTimes(2)
      for (const call of io.session.mock.calls) expect(call[0]).toBe(req.headers)
    },
  )

  it.each(['before', 'after'] as const)('withholds bytes when the request aborts %s I/O', async when => {
    const controller = new AbortController()
    if (when === 'before') controller.abort()
    else io.download.mockImplementationOnce(async () => {
      controller.abort()
      return validResult()
    })
    await failure(await GET(request(controller.signal)), 503, 'INVOICE_PDF_UNAVAILABLE')
    expect(io.download).toHaveBeenCalledTimes(when === 'before' ? 0 : 1)
  })

  it.each(['A', 'A' + 'b_-'.repeat(33)])(
    'serves an allowed 1–100 character invoice number without changing it: %s', async invoiceNo => {
      io.download.mockResolvedValueOnce({ bytes: pdf, invoiceNo })
      const response = await GET(request())
      expect(response.status).toBe(200)
      privateHeaders(response)
      expect(response.headers.get('content-type')).toBe('application/pdf')
      expect(response.headers.get('content-length')).toBe(String(pdf.length))
      expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${invoiceNo}.pdf"`)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
      expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf)
    },
  )

  it.each([
    '', 'A'.repeat(101), 'A.pdf', 'A/B', 'A";filename=other', 'A\r\nX-Injected: yes', '_A', '合成编号',
  ])('rejects an unsafe invoice number from the service boundary: %s', async invoiceNo => {
    io.download.mockResolvedValueOnce({ bytes: pdf, invoiceNo })
    const response = await GET(request())
    await failure(response, 503, 'INVOICE_PDF_UNAVAILABLE')
    expect(response.headers.get('x-injected')).toBeNull()
  })
})
