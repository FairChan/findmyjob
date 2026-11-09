import { createHash } from 'node:crypto'
import { inspect } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { PDFDocument } from 'pdf-lib'

const io = vi.hoisted(() => ({
  render: vi.fn(), put: vi.fn(), get: vi.fn(), remove: vi.fn(),
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(),
}))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: async () => undefined }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/lib/invoice-pdf', () => ({ renderInvoicePdf: io.render }))
vi.mock('@/lib/storage', () => ({
  getObjectBytes: io.get, putObject: io.put, deleteAllVersions: io.remove,
  getSignedDownloadUrl: vi.fn(), getSignedDisplayUrl: vi.fn(),
}))
vi.mock('@/server/lib/logger', () => ({ logger: { error: io.error, warn: io.warn, info: io.info, debug: io.debug } }))

import { setupTestDb, testDb } from '../setup/db'
import { PROOF_BYTES } from '../helpers/billing-t02'
import {
  INVOICE_SCOPE, PDF_MAX_BYTES, counterState, deferred, financialState, issue,
  makePdfDue, paidUnissuedFixture, runPdf,
} from '../helpers/invoices-t05'
import { AppError } from '@/server/errors'
import { LOCK_NS, lockXact } from '@/server/lib/advisory-locks'
import { processInvoicePdf } from '@/server/services/invoice-delivery'

setupTestDb()
let pdf: Buffer
beforeEach(async () => {
  vi.resetAllMocks()
  const doc = await PDFDocument.create()
  doc.addPage([300, 300])
  pdf = Buffer.from(await doc.save())
  io.get.mockResolvedValue(PROOF_BYTES)
  io.render.mockResolvedValue(pdf)
  io.put.mockResolvedValue(undefined)
  io.remove.mockResolvedValue(undefined)
})

describe('T05 PDF publication and persisted retry state', () => {
  it('publishes one candidate, hash and byte count without changing the invoice or financial facts', async () => {
    const f = await paidUnissuedFixture(true)
    const invoice = await issue(f)
    const financial = await financialState(f)
    const counters = await counterState()
    const ready = await runPdf(invoice.id)
    expect(ready).toMatchObject({
      invoiceNo: invoice.invoiceNo, invoiceSnapshot: invoice.invoiceSnapshot,
      pdfStatus: 'READY', pdfAttempts: 1, pdfErrorCode: null,
      pdfLeaseToken: null, pdfLeaseExpiresAt: null,
      pdfSha256: createHash('sha256').update(pdf).digest('hex'), pdfSizeBytes: pdf.length,
    })
    expect(io.render).toHaveBeenCalledTimes(1)
    expect(io.render.mock.calls[0][0]).toEqual(invoice.invoiceSnapshot)
    expect(io.put).toHaveBeenCalledTimes(1)
    expect(io.put.mock.calls[0].slice(0, 3)).toEqual([ready.pdfKey, pdf, 'application/pdf'])
    expect(ready.pdfKey).toMatch(new RegExp(`^invoices/${f.ctx.companyId}/${invoice.id}/[^/]+\\.pdf$`))
    expect(io.remove).not.toHaveBeenCalled()
    expect(await financialState(f)).toEqual(financial)
    expect(await counterState()).toEqual(counters)
    await runPdf(invoice.id)
    expect(io.render).toHaveBeenCalledTimes(1)
    expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toEqual(ready)
  })

  it.each(['render', 'put'] as const)('keeps the issued number after %s failure and retries the same snapshot', async failure => {
    const f = await paidUnissuedFixture()
    const invoice = await issue(f)
    const before = await financialState(f)
    const counters = await counterState()
    const privateError = 'PRIVATE_PDF_FAILURE_SENTINEL: invoices/private-key; buyer address'
    io[failure].mockRejectedValueOnce(new Error(privateError))
    const started = Date.now()
    const failed = await runPdf(invoice.id)
    expect(failed).toMatchObject({
      invoiceNo: invoice.invoiceNo, invoiceSnapshot: invoice.invoiceSnapshot,
      pdfStatus: 'FAILED', pdfAttempts: 1, pdfKey: null, pdfLeaseToken: null,
    })
    expect(failed.pdfErrorCode).toBe(failure === 'render' ? 'PDF_RENDER_FAILED' : 'PDF_STORAGE_FAILED')
    expect(failed.pdfNextAttemptAt?.getTime()).toBeGreaterThanOrEqual(started + 60_000 - 2000)
    expect(failed.pdfNextAttemptAt?.getTime()).toBeLessThanOrEqual(Date.now() + 60_000 + 2000)
    expect(JSON.stringify(failed)).not.toContain(privateError)
    expect(inspect([io.error.mock.calls, io.warn.mock.calls, io.info.mock.calls, io.debug.mock.calls], { depth: null })).not.toContain(privateError)
    const renders = io.render.mock.calls.length
    await runPdf(invoice.id)
    expect(io.render).toHaveBeenCalledTimes(renders)
    expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toEqual(failed)
    await makePdfDue(invoice.id)
    const ready = await runPdf(invoice.id)
    expect(ready).toMatchObject({ pdfStatus: 'READY', pdfAttempts: 2, invoiceNo: invoice.invoiceNo, invoiceSnapshot: invoice.invoiceSnapshot })
    const candidateKeys = io.put.mock.calls.map(call => call[0])
    expect(new Set(candidateKeys).size).toBe(candidateKeys.length)
    expect(await testDb.invoice.count()).toBe(1)
    expect(await financialState(f)).toEqual(before)
    expect(await counterState()).toEqual(counters)
  })

  it('persists a maximum of three claims and does not reset attempts on later invocations', async () => {
    const invoice = await issue(await paidUnissuedFixture())
    io.render.mockRejectedValue(new Error('synthetic transient render failure'))
    await runPdf(invoice.id)
    await makePdfDue(invoice.id)
    const started = Date.now()
    const second = await runPdf(invoice.id)
    expect(second).toMatchObject({ pdfStatus: 'FAILED', pdfAttempts: 2 })
    expect(second.pdfNextAttemptAt?.getTime()).toBeGreaterThanOrEqual(started + 300_000 - 2000)
    expect(second.pdfNextAttemptAt?.getTime()).toBeLessThanOrEqual(Date.now() + 300_000 + 2000)
    await makePdfDue(invoice.id)
    const terminal = await runPdf(invoice.id)
    expect(terminal).toMatchObject({ pdfStatus: 'FAILED', pdfAttempts: 3, pdfNextAttemptAt: null, pdfLeaseToken: null, pdfKey: null })
    await Promise.all([runPdf(invoice.id), runPdf(invoice.id)])
    expect(io.render).toHaveBeenCalledTimes(3)
    expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toEqual(terminal)
  })

  it('stops on unsupported glyphs without silently substituting a legal heading', async () => {
    const invoice = await issue(await paidUnissuedFixture())
    io.render.mockRejectedValue(new AppError('Unsupported glyph', 'UNSUPPORTED_GLYPH'))
    const failed = await runPdf(invoice.id)
    expect(failed).toMatchObject({ pdfStatus: 'FAILED', pdfAttempts: 1, pdfNextAttemptAt: null, pdfErrorCode: 'UNSUPPORTED_GLYPH', pdfKey: null })
    await runPdf(invoice.id)
    expect(io.render).toHaveBeenCalledTimes(1)
    expect(io.put).not.toHaveBeenCalled()
    expect(failed.invoiceSnapshot).toEqual(invoice.invoiceSnapshot)
  })

  it('never reconstructs a legacy null snapshot from present company or plan data', async () => {
    const invoice = await issue(await paidUnissuedFixture())
    await testDb.invoice.update({ where: { id: invoice.id }, data: { invoiceSnapshot: Prisma.DbNull } })
    const failed = await runPdf(invoice.id)
    expect(failed).toMatchObject({
      invoiceNo: invoice.invoiceNo, invoiceSnapshot: null, pdfStatus: 'FAILED',
      pdfNextAttemptAt: null, pdfErrorCode: 'LEGACY_INVOICE_SNAPSHOT_MISSING', pdfKey: null,
    })
    expect(io.render).not.toHaveBeenCalled()
    expect(io.put).not.toHaveBeenCalled()
  })

  it('claims a due invoice only once across concurrent worker invocations', async () => {
    const invoice = await issue(await paidUnissuedFixture())
    await Promise.all(Array.from({ length: 5 }, () => runPdf(invoice.id)))
    expect(io.render).toHaveBeenCalledTimes(1)
    expect(io.put).toHaveBeenCalledTimes(1)
    expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toMatchObject({ pdfStatus: 'READY', pdfAttempts: 1 })
  })

  it('reclaims an expired lease without forgetting the attempt already consumed', async () => {
    const invoice = await issue(await paidUnissuedFixture())
    await testDb.invoice.update({ where: { id: invoice.id }, data: {
      pdfStatus: 'PROCESSING', pdfAttempts: 1, pdfLeaseToken: 'expired-attempt',
      pdfLeaseExpiresAt: new Date('2000-01-01T00:00:00Z'),
    } })
    expect(await runPdf(invoice.id)).toMatchObject({ pdfStatus: 'READY', pdfAttempts: 2, invoiceNo: invoice.invoiceNo })
    expect(io.render).toHaveBeenCalledTimes(1)
  })

  it('does not steal an unexpired persisted lease', async () => {
    const invoice = await issue(await paidUnissuedFixture())
    const leased = await testDb.invoice.update({ where: { id: invoice.id }, data: {
      pdfStatus: 'PROCESSING', pdfAttempts: 1, pdfLeaseToken: 'active-other-worker',
      pdfLeaseExpiresAt: new Date(Date.now() + 60_000),
    } })
    expect(await runPdf(invoice.id)).toEqual(leased)
    expect(io.render).not.toHaveBeenCalled()
    expect(io.put).not.toHaveBeenCalled()
  })

  it('fences an old uploaded candidate and cleans only that candidate, preserving the winner', async () => {
    const f = await paidUnissuedFixture()
    const invoice = await issue(f)
    const uploaded = deferred<string>()
    const release = deferred<void>()
    io.put.mockImplementationOnce(async (key: string) => { uploaded.resolve(key); await release.promise })
    const running = processInvoicePdf(invoice.id)
    const settled = Promise.allSettled([running])
    let candidate: string | undefined
    const winnerKey = `invoices/${f.ctx.companyId}/${invoice.id}/newer-winning-token.pdf`
    try {
      candidate = await Promise.race([
        uploaded.promise,
        settled.then(() => { throw new Error('Worker ended before upload barrier') }),
      ])
      const leased = await testDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
      expect(leased).toMatchObject({ pdfStatus: 'PROCESSING', pdfAttempts: 1, pdfLeaseToken: expect.any(String) })
      // Model a replacement process having expired, reclaimed and published this lease.
      // This is a fencing adversary, not a second render using the same local semaphore.
      await testDb.invoice.update({ where: { id: invoice.id }, data: {
        pdfStatus: 'READY', pdfAttempts: 2, pdfLeaseToken: null, pdfLeaseExpiresAt: null,
        pdfNextAttemptAt: null, pdfKey: winnerKey, pdfSizeBytes: pdf.length,
        pdfSha256: createHash('sha256').update(pdf).digest('hex'),
      } })
    } finally {
      release.resolve()
      await settled
    }
    expect(candidate).not.toBe(winnerKey)
    expect(io.remove).toHaveBeenCalledExactlyOnceWith(candidate, { signal: expect.any(AbortSignal) })
    expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toMatchObject({
      pdfStatus: 'READY', pdfAttempts: 2, pdfKey: winnerKey, invoiceSnapshot: invoice.invoiceSnapshot,
    })
  })

  it('does not let an old render failure overwrite a newer processing lease', async () => {
    const invoice = await issue(await paidUnissuedFixture())
    const entered = deferred<void>()
    const release = deferred<void>()
    io.render.mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      throw new Error('synthetic late failure from expired worker')
    })
    const settled = Promise.allSettled([processInvoicePdf(invoice.id)])
    try {
      await Promise.race([entered.promise, settled.then(() => { throw new Error('Worker ended before render barrier') })])
      await testDb.invoice.update({ where: { id: invoice.id }, data: {
        pdfStatus: 'PROCESSING', pdfAttempts: 2, pdfLeaseToken: 'replacement-owner',
        pdfLeaseExpiresAt: new Date(Date.now() + 60_000),
      } })
    } finally {
      release.resolve()
      await settled
    }
    expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toMatchObject({
      pdfStatus: 'PROCESSING', pdfAttempts: 2, pdfLeaseToken: 'replacement-owner', pdfErrorCode: null,
    })
  })

  it('releases company and numbering locks before rendering and uploading', async () => {
    const f = await paidUnissuedFixture()
    const invoice = await issue(f)
    let observed = 0
    async function probeLocks() {
      await testDb.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`
        await lockXact(tx, LOCK_NS.CREDIT, f.ctx.companyId)
        await lockXact(tx, LOCK_NS.INVOICE_NUMBER, INVOICE_SCOPE)
      }, { timeout: 2000 })
      observed++
    }
    io.render.mockImplementationOnce(async () => { await probeLocks(); return pdf })
    io.put.mockImplementationOnce(probeLocks)
    expect(await runPdf(invoice.id)).toMatchObject({ pdfStatus: 'READY' })
    expect(observed).toBe(2)
  })

  it('rejects an oversized renderer result before object publication', async () => {
    const invoice = await issue(await paidUnissuedFixture())
    io.render.mockResolvedValue(Buffer.alloc(PDF_MAX_BYTES + 1, 32))
    const failed = await runPdf(invoice.id)
    expect(failed).toMatchObject({ pdfStatus: 'FAILED', pdfAttempts: 1, pdfKey: null })
    expect(io.put).not.toHaveBeenCalled()
    expect(failed.invoiceNo).toBe(invoice.invoiceNo)
  })
})
