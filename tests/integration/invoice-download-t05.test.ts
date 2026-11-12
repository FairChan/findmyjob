import { createHash } from 'node:crypto'
import { inspect } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { PDFDocument } from 'pdf-lib'

const io = vi.hoisted(() => ({
  get: vi.fn(), signedDownload: vi.fn(), signedDisplay: vi.fn(),
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(),
}))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: async () => undefined }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock('@/lib/storage', () => ({
  getObjectBytes: io.get, putObject: vi.fn(), deleteAllVersions: vi.fn(),
  getSignedDownloadUrl: io.signedDownload, getSignedDisplayUrl: io.signedDisplay,
}))
vi.mock('@/server/lib/logger', () => ({ logger: { error: io.error, warn: io.warn, info: io.info, debug: io.debug } }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createStudent } from '../factories'
import { PROOF_BYTES, setting } from '../helpers/billing-t02'
import { ISSUER_SETTING, PDF_MAX_BYTES, counterState, financialState, issue, paidUnissuedFixture } from '../helpers/invoices-t05'
import { getSession } from '@/server/auth'
import { GET } from '@/app/api/invoices/[id]/download/route'

setupTestDb()
let pdf: Buffer
beforeEach(async () => {
  vi.resetAllMocks()
  const doc = await PDFDocument.create()
  doc.addPage([300, 300])
  pdf = Buffer.from(await doc.save())
  io.get.mockResolvedValue(PROOF_BYTES)
})

function session(userId: string | null) {
  if (userId === null) { vi.mocked(getSession).mockResolvedValue(null); return }
  vi.mocked(getSession).mockResolvedValue({
    user: { id: userId } as never,
    session: {
      id: 'synthetic-session', userId, token: 'synthetic-session-token',
      createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
      ipAddress: null, userAgent: null,
    },
  })
}

function download(id: string) {
  // The current route() wrapper takes Request only, not a Next params argument.
  return GET(new Request(`http://localhost/api/invoices/${encodeURIComponent(id)}/download`))
}

function privateResponse(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  expect(response.headers.get('location')).toBeNull()
}

async function readyFixture() {
  const f = await paidUnissuedFixture()
  const issued = await issue(f)
  const invoice = await testDb.invoice.update({ where: { id: issued.id }, data: {
    pdfStatus: 'READY', pdfAttempts: 1, pdfNextAttemptAt: null,
    pdfKey: `invoices/${f.ctx.companyId}/${issued.id}/PRIVATE_STORAGE_SENTINEL.pdf`,
    pdfSha256: createHash('sha256').update(pdf).digest('hex'), pdfSizeBytes: pdf.length,
  } })
  io.get.mockReset().mockResolvedValue(pdf)
  io.error.mockClear(); io.warn.mockClear(); io.info.mockClear(); io.debug.mockClear()
  session(f.ctx.userId)
  return { ...f, invoice }
}

describe('T05 invoice download uses current company authorization and private bytes', () => {
  it('allows an active unverified OWNER to download bounded bytes after sales and issuer shutdown', async () => {
    const f = await readyFixture()
    expect(await testDb.company.findUnique({ where: { id: f.ctx.companyId } })).toMatchObject({ verificationStatus: 'UNSUBMITTED' })
    await setting('billing.enabled', false)
    await testDb.plan.update({ where: { id: f.plan.id }, data: { isActive: false, isPublic: false } })
    await testDb.systemSetting.deleteMany({ where: { key: ISSUER_SETTING } })
    const response = await download(f.invoice.id)
    expect(response.status).toBe(200)
    privateResponse(response)
    expect(response.headers.get('content-type')).toMatch(/^application\/pdf(?:;|$)/)
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${f.invoice.invoiceNo}.pdf"`)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf)
    expect(io.get).toHaveBeenCalledTimes(1)
    expect(io.get.mock.calls[0][0]).toBe(f.invoice.pdfKey)
    const opts = io.get.mock.calls[0][1] as { maxBytes: number; signal: AbortSignal }
    expect(opts.maxBytes).toBeGreaterThan(0)
    expect(opts.maxBytes).toBeLessThanOrEqual(PDF_MAX_BYTES)
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(io.signedDownload).not.toHaveBeenCalled()
    expect(io.signedDisplay).not.toHaveBeenCalled()
  })

  it.each(['recruiter', 'company-admin', 'removed-member', 'suspended-user', 'inactive-company', 'platform-admin', 'student', 'anonymous'])(
    'rejects %s before reading private objects', async variant => {
      const f = await readyFixture()
      if (variant === 'recruiter') await testDb.companyMember.update({ where: { userId: f.ctx.userId }, data: { role: 'RECRUITER' } })
      if (variant === 'company-admin') await testDb.companyMember.update({ where: { userId: f.ctx.userId }, data: { role: 'ADMIN' } })
      if (variant === 'removed-member') await testDb.companyMember.delete({ where: { userId: f.ctx.userId } })
      if (variant === 'suspended-user') await testDb.user.update({ where: { id: f.ctx.userId }, data: { status: 'SUSPENDED' } })
      if (variant === 'inactive-company') await testDb.company.update({ where: { id: f.ctx.companyId }, data: { isActive: false } })
      if (variant === 'platform-admin') session((await createAdmin(testDb)).userId)
      if (variant === 'student') session((await createStudent(testDb)).userId)
      if (variant === 'anonymous') session(null)
      const response = await download(f.invoice.id)
      expect(response.status).toBe(403)
      privateResponse(response)
      expect(await response.json()).toEqual({ ok: false, code: 'FORBIDDEN' })
      expect(io.get).not.toHaveBeenCalled()
      expect(io.signedDownload).not.toHaveBeenCalled()
    },
  )

  it('makes another company invoice indistinguishable from an unknown invoice', async () => {
    const f = await readyFixture()
    session((await createEmployer(testDb)).userId)
    const foreign = await download(f.invoice.id)
    const missing = await download('c' + '0'.repeat(24))
    expect(foreign.status).toBe(404)
    expect(missing.status).toBe(404)
    privateResponse(foreign)
    privateResponse(missing)
    expect(await foreign.json()).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await missing.json()).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(io.get).not.toHaveBeenCalled()
  })

  it.each(['demotion', 'removal', 'suspension', 'deactivation'])(
    'rechecks authorization after object read when %s occurs', async variant => {
      const f = await readyFixture()
      io.get.mockImplementationOnce(async () => {
        if (variant === 'demotion') await testDb.companyMember.update({ where: { userId: f.ctx.userId }, data: { role: 'ADMIN' } })
        if (variant === 'removal') await testDb.companyMember.delete({ where: { userId: f.ctx.userId } })
        if (variant === 'suspension') await testDb.user.update({ where: { id: f.ctx.userId }, data: { status: 'SUSPENDED' } })
        if (variant === 'deactivation') await testDb.company.update({ where: { id: f.ctx.companyId }, data: { isActive: false } })
        return pdf
      })
      const response = await download(f.invoice.id)
      expect(io.get).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(403)
      privateResponse(response)
      expect(await response.json()).toEqual({ ok: false, code: 'FORBIDDEN' })
    },
  )

  it.each([
    { pdfStatus: 'QUEUED', status: 409, code: 'INVOICE_PDF_PENDING', attempts: 0 },
    { pdfStatus: 'PROCESSING', status: 409, code: 'INVOICE_PDF_PENDING', attempts: 1 },
    { pdfStatus: 'FAILED', status: 503, code: 'INVOICE_PDF_UNAVAILABLE', attempts: 3 },
  ] as const)('GET preserves $pdfStatus state, numbering, attempts and financial effects', async entry => {
    const f = await readyFixture()
    const invoice = await testDb.invoice.update({ where: { id: f.invoice.id }, data: {
      pdfStatus: entry.pdfStatus, pdfAttempts: entry.attempts,
      pdfKey: null, pdfSha256: null, pdfSizeBytes: null,
      pdfLeaseToken: entry.pdfStatus === 'PROCESSING' ? 'active-token' : null,
      pdfLeaseExpiresAt: entry.pdfStatus === 'PROCESSING' ? new Date(Date.now() + 60_000) : null,
    } })
    const before = await financialState(f)
    const counters = await counterState()
    for (let i = 0; i < 3; i++) {
      const response = await download(invoice.id)
      expect(response.status).toBe(entry.status)
      privateResponse(response)
      expect(await response.json()).toEqual({ ok: false, code: entry.code })
    }
    expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toEqual(invoice)
    expect(await financialState(f)).toEqual(before)
    expect(await counterState()).toEqual(counters)
    expect(io.get).not.toHaveBeenCalled()
  })

  it('does not turn an order id GET into an issuance command', async () => {
    const f = await paidUnissuedFixture()
    session(f.ctx.userId)
    const before = await financialState(f)
    const response = await download(f.order.id)
    expect(response.status).toBe(404)
    privateResponse(response)
    expect(await testDb.invoice.count()).toBe(0)
    expect(await counterState()).toEqual([])
    expect(await financialState(f)).toEqual(before)
  })

  it.each(['storage-error', 'invalid-magic', 'too-large', 'hash-mismatch'])(
    'returns a sanitized unavailable response for %s', async variant => {
      const f = await readyFixture()
      const privateError = 'PRIVATE_OBJECT_ERROR_SENTINEL at s3://private-bucket/buyer-address'
      if (variant === 'storage-error') io.get.mockRejectedValueOnce(new Error(privateError))
      if (variant === 'invalid-magic') io.get.mockResolvedValueOnce(Buffer.from('not a PDF'))
      if (variant === 'too-large') io.get.mockResolvedValueOnce(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(PDF_MAX_BYTES)]))
      if (variant === 'hash-mismatch') await testDb.invoice.update({ where: { id: f.invoice.id }, data: { pdfSha256: '0'.repeat(64) } })
      const response = await download(f.invoice.id)
      expect(response.status).toBe(503)
      privateResponse(response)
      expect(await response.json()).toEqual({ ok: false, code: 'INVOICE_PDF_UNAVAILABLE' })
      const logs = inspect([io.error.mock.calls, io.warn.mock.calls, io.info.mock.calls, io.debug.mock.calls], { depth: null })
      expect(logs).not.toContain(privateError)
      expect(logs).not.toContain('PRIVATE_STORAGE_SENTINEL')
      expect(io.signedDownload).not.toHaveBeenCalled()
      expect(await testDb.invoice.findUnique({ where: { id: f.invoice.id } })).toMatchObject({
        invoiceNo: f.invoice.invoiceNo, invoiceSnapshot: f.invoice.invoiceSnapshot,
      })
      expect(await counterState()).toMatchObject([{ lastValue: 1n }])
    },
  )

  it('may serve an existing valid legacy PDF without fabricating a missing snapshot', async () => {
    const f = await readyFixture()
    await testDb.invoice.update({ where: { id: f.invoice.id }, data: { invoiceSnapshot: Prisma.DbNull } })
    const response = await download(f.invoice.id)
    expect(response.status).toBe(200)
    privateResponse(response)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf)
    expect(await testDb.invoice.findUnique({ where: { id: f.invoice.id } })).toMatchObject({ invoiceSnapshot: null, invoiceNo: f.invoice.invoiceNo })
  })
})
