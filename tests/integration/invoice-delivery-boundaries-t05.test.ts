import { createHash } from 'node:crypto'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { PDFDocument } from 'pdf-lib'

const io = vi.hoisted(() => ({
  render: vi.fn(), put: vi.fn(), get: vi.fn(), remove: vi.fn(),
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(),
}))
const faults = vi.hoisted(() => ({ failPublishAcknowledgement: false, readyWrites: 0 }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: async () => undefined }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  const client = testDb.$extends({ query: { invoice: {
    async updateMany({ args, query }) {
      const result = await query(args)
      if (args.data.pdfStatus === 'READY' && result.count === 1) faults.readyWrites++
      return result
    },
  } } })
  // Keep real transactions and writes. Only lose the acknowledgement AFTER the
  // real publication transaction has committed; throwing inside it would roll back.
  return { db: new Proxy(client, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver)
      return async (
        operation: Parameters<typeof client.$transaction>[0],
        options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
      ) => {
        const before = faults.readyWrites
        const result = await target.$transaction(operation, options)
        if (faults.failPublishAcknowledgement && faults.readyWrites > before) {
          faults.failPublishAcknowledgement = false
          throw new Error('PRIVATE_SYNTHETIC_PUBLICATION_ACK_FAILURE')
        }
        return result
      }
    },
  }) }
})
vi.mock('@/server/lib/invoice-pdf', () => ({ renderInvoicePdf: io.render }))
vi.mock('@/lib/storage', () => ({
  getObjectBytes: io.get, putObject: io.put, deleteAllVersions: io.remove,
}))
vi.mock('@/server/lib/logger', () => ({ logger: {
  error: io.error, warn: io.warn, info: io.info, debug: io.debug,
} }))

import { setupTestDb, testDb } from '../setup/db'
import { PROOF_BYTES } from '../helpers/billing-t02'
import { deferred, issue, paidUnissuedFixture } from '../helpers/invoices-t05'
import { getInvoiceDownload, processInvoicePdf } from '@/server/services/invoice-delivery'

setupTestDb()
let pdf: Buffer
beforeEach(async () => {
  vi.resetAllMocks()
  faults.failPublishAcknowledgement = false
  faults.readyWrites = 0
  const doc = await PDFDocument.create()
  doc.addPage([300, 300])
  pdf = Buffer.from(await doc.save())
  io.get.mockResolvedValue(PROOF_BYTES)
  io.render.mockResolvedValue(pdf)
  io.put.mockResolvedValue(undefined)
  io.remove.mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

// Invoke an observed delivery-owned timer instead of replacing Date/performance
// or advancing Prisma's timers. The real timer remains active until service cleanup.
function captureTimer(milliseconds: number) {
  const realSetTimeout = globalThis.setTimeout
  let fire: (() => void) | undefined
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => {
    if (delay === milliseconds && !fire) fire = () => handler(...args)
    return realSetTimeout(handler, delay, ...args)
  })
  return () => {
    if (!fire) throw new Error('Expected delivery cancellation timer was not observed')
    fire()
  }
}

async function enteredOrFinished<T>(entered: Promise<T>, settled: Promise<unknown>): Promise<T> {
  return Promise.race([entered, settled.then(() => { throw new Error('Delivery ended before the I/O barrier') })])
}

describe('T05 additional delivery ownership and recovery boundaries', () => {
  it('makes a crashed third lease terminal without allocating a fourth claim', async () => {
    const invoice = await issue(await paidUnissuedFixture())
    await testDb.invoice.update({ where: { id: invoice.id }, data: {
      pdfStatus: 'PROCESSING', pdfAttempts: 3, pdfLeaseToken: 'crashed-final-claim',
      pdfLeaseExpiresAt: new Date('2000-01-01T00:00:00Z'), pdfNextAttemptAt: null,
    } })
    await processInvoicePdf(invoice.id)
    const terminal = await testDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(terminal).toMatchObject({
      pdfStatus: 'FAILED', pdfAttempts: 3, pdfNextAttemptAt: null,
      pdfLeaseToken: null, pdfLeaseExpiresAt: null, pdfErrorCode: 'PDF_LEASE_EXPIRED',
      invoiceNo: invoice.invoiceNo, invoiceSnapshot: invoice.invoiceSnapshot,
    })
    await processInvoicePdf(invoice.id)
    expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toEqual(terminal)
    expect(io.render).not.toHaveBeenCalled()
    expect(io.put).not.toHaveBeenCalled()
    expect(io.remove).not.toHaveBeenCalled()
  })

  it('keeps the committed winner when publication acknowledgement is lost', async () => {
    const invoice = await issue(await paidUnissuedFixture())
    faults.failPublishAcknowledgement = true
    await expect(processInvoicePdf(invoice.id)).rejects.toMatchObject({ code: 'INVOICE_PDF_UNAVAILABLE' })
    const winner = await testDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(winner).toMatchObject({
      pdfStatus: 'READY', pdfAttempts: 1, pdfLeaseToken: null, pdfErrorCode: null,
      pdfKey: io.put.mock.calls[0][0], pdfSizeBytes: pdf.length,
      pdfSha256: createHash('sha256').update(pdf).digest('hex'),
    })
    expect(io.remove).not.toHaveBeenCalled()
    await processInvoicePdf(invoice.id)
    expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toEqual(winner)
    expect(io.render).toHaveBeenCalledTimes(1)
    expect(io.put).toHaveBeenCalledTimes(1)
    expect(inspect(io.warn.mock.calls, { depth: null })).not.toContain('PRIVATE_SYNTHETIC_PUBLICATION_ACK_FAILURE')
  })

  it('does not claim another invoice while the local renderer is busy', async () => {
    const first = await issue(await paidUnissuedFixture())
    const second = await issue(await paidUnissuedFixture())
    const entered = deferred<void>()
    const release = deferred<void>()
    io.render.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return pdf })
    const settled = Promise.allSettled([processInvoicePdf(first.id)])
    try {
      await enteredOrFinished(entered.promise, settled)
      await processInvoicePdf(second.id)
      expect(await testDb.invoice.findUnique({ where: { id: second.id } })).toEqual(second)
      expect(io.render).toHaveBeenCalledTimes(1)
    } finally {
      release.resolve()
      await settled
    }
    await processInvoicePdf(second.id)
    expect(await testDb.invoice.findUnique({ where: { id: second.id } })).toMatchObject({ pdfStatus: 'READY', pdfAttempts: 1 })
  })

  it.each(['expired-lease', 'changed-attempt'] as const)(
    'refuses a same-token publication after %s', async variant => {
      const invoice = await issue(await paidUnissuedFixture())
      const entered = deferred<string>()
      const release = deferred<void>()
      io.put.mockImplementationOnce(async (key: string) => { entered.resolve(key); await release.promise })
      const settled = Promise.allSettled([processInvoicePdf(invoice.id)])
      let candidate: string | undefined
      let fenced: Awaited<ReturnType<typeof testDb.invoice.findUniqueOrThrow>> | undefined
      try {
        candidate = await enteredOrFinished(entered.promise, settled)
        const claimed = await testDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
        fenced = await testDb.invoice.update({ where: { id: invoice.id }, data: variant === 'expired-lease'
          ? { pdfLeaseExpiresAt: new Date('2000-01-01T00:00:00Z') }
          : { pdfAttempts: claimed.pdfAttempts + 1 } })
        expect(fenced.pdfLeaseToken).toBe(claimed.pdfLeaseToken)
      } finally {
        release.resolve()
        await settled
      }
      expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toEqual(fenced)
      expect(io.remove).toHaveBeenCalledExactlyOnceWith(candidate, { signal: expect.any(AbortSignal) })
    },
  )

  it('holds the local slot until a cancelled renderer has actually settled', async () => {
    const first = await issue(await paidUnissuedFixture())
    const second = await issue(await paidUnissuedFixture())
    const entered = deferred<void>()
    const aborted = deferred<void>()
    const releaseCleanup = deferred<void>()
    const fireRenderDeadline = captureTimer(15_000)
    io.render.mockImplementationOnce(async (_snapshot: unknown, signal: AbortSignal) => {
      signal.addEventListener('abort', () => aborted.resolve(), { once: true })
      entered.resolve()
      await aborted.promise
      await releaseCleanup.promise
      throw Object.assign(new Error('Synthetic renderer stopped'), { name: 'AbortError' })
    })
    let finished = false
    const running = processInvoicePdf(first.id)
    const settled = Promise.allSettled([running]).then(result => { finished = true; return result })
    try {
      await enteredOrFinished(entered.promise, settled)
      fireRenderDeadline()
      await enteredOrFinished(aborted.promise, settled)
      await processInvoicePdf(second.id)
      expect(finished).toBe(false)
      expect(await testDb.invoice.findUnique({ where: { id: second.id } })).toEqual(second)
      expect(await testDb.invoice.findUnique({ where: { id: first.id } })).toMatchObject({
        pdfStatus: 'PROCESSING', pdfAttempts: 1,
      })
    } finally {
      releaseCleanup.resolve()
      await settled
    }
    expect(await testDb.invoice.findUnique({ where: { id: first.id } })).toMatchObject({
      pdfStatus: 'FAILED', pdfAttempts: 1, pdfErrorCode: 'PDF_RENDER_FAILED',
    })
    await processInvoicePdf(second.id)
    expect(await testDb.invoice.findUnique({ where: { id: second.id } })).toMatchObject({ pdfStatus: 'READY', pdfAttempts: 1 })
  })

  it('aborts upload at the total deadline, waits for cleanup and leaves recovery to the persisted lease', async () => {
    const first = await issue(await paidUnissuedFixture())
    const second = await issue(await paidUnissuedFixture())
    const entered = deferred<void>()
    const aborted = deferred<void>()
    const releaseCleanup = deferred<void>()
    const fireTotalDeadline = captureTimer(30_000)
    io.put.mockImplementationOnce(async (_key: string, _bytes: Buffer, _mime: string, options: { signal: AbortSignal }) => {
      options.signal.addEventListener('abort', () => aborted.resolve(), { once: true })
      entered.resolve()
      await aborted.promise
      await releaseCleanup.promise
      throw Object.assign(new Error('Synthetic upload cancelled'), { name: 'AbortError' })
    })
    let finished = false
    const settled = Promise.allSettled([processInvoicePdf(first.id)]).then(result => { finished = true; return result })
    try {
      await enteredOrFinished(entered.promise, settled)
      fireTotalDeadline()
      await enteredOrFinished(aborted.promise, settled)
      await processInvoicePdf(second.id)
      expect(finished).toBe(false)
      expect(await testDb.invoice.findUnique({ where: { id: second.id } })).toEqual(second)
    } finally {
      releaseCleanup.resolve()
      await settled
    }
    expect(await settled).toMatchObject([{ status: 'rejected', reason: { code: 'INVOICE_PDF_UNAVAILABLE' } }])
    expect(await testDb.invoice.findUnique({ where: { id: first.id } })).toMatchObject({
      pdfStatus: 'PROCESSING', pdfAttempts: 1, pdfLeaseToken: expect.any(String), pdfKey: null, pdfErrorCode: null,
    })
    expect(io.remove).not.toHaveBeenCalled()
    await testDb.invoice.update({ where: { id: first.id }, data: { pdfLeaseExpiresAt: new Date('2000-01-01T00:00:00Z') } })
    await processInvoicePdf(first.id)
    expect(await testDb.invoice.findUnique({ where: { id: first.id } })).toMatchObject({ pdfStatus: 'READY', pdfAttempts: 2 })
  })

  it.each(['legacy', 'modern-final-attempt'] as const)(
    'keeps a valid %s READY object recoverable after a transient read failure', async variant => {
      const f = await paidUnissuedFixture()
      const issued = await issue(f)
      const original = await testDb.invoice.update({ where: { id: issued.id }, data: {
        ...(variant === 'legacy' ? { invoiceSnapshot: Prisma.DbNull } : {}),
        pdfStatus: 'READY', pdfAttempts: 3, pdfNextAttemptAt: null,
        pdfKey: `invoices/${f.ctx.companyId}/${issued.id}/synthetic-published.pdf`,
        pdfSha256: createHash('sha256').update(pdf).digest('hex'), pdfSizeBytes: pdf.length,
      } })
      io.get.mockReset().mockRejectedValueOnce(new Error('Synthetic transient transport outage')).mockResolvedValue(pdf)
      await expect(getInvoiceDownload(f.ctx, original.id)).rejects.toMatchObject({ code: 'INVOICE_PDF_UNAVAILABLE' })
      const afterFailure = await testDb.invoice.findUniqueOrThrow({ where: { id: original.id } })
      expect(afterFailure).toMatchObject({
        pdfStatus: 'READY', pdfKey: original.pdfKey, pdfSha256: original.pdfSha256,
        pdfSizeBytes: original.pdfSizeBytes, pdfAttempts: 3, invoiceSnapshot: original.invoiceSnapshot,
      })
      await expect(getInvoiceDownload(f.ctx, original.id)).resolves.toEqual({ bytes: pdf, invoiceNo: original.invoiceNo })
      expect(io.get).toHaveBeenCalledTimes(2)
      expect(io.render).not.toHaveBeenCalled()
      expect(io.put).not.toHaveBeenCalled()
      expect(io.remove).not.toHaveBeenCalled()
      expect(await testDb.invoice.count()).toBe(1)
    },
  )

  it.each(['missing', 'oversized'] as const)('requeues a confirmed %s modern object without issuing another invoice', async failure => {
    const f = await paidUnissuedFixture()
    const invoice = await issue(f)
    await processInvoicePdf(invoice.id)
    const before = await testDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(before.pdfStatus).toBe('READY')
    io.get.mockRejectedValueOnce(failure === 'missing'
      ? Object.assign(new Error('PRIVATE_MISSING_OBJECT'), { name: 'NoSuchKey' })
      : Object.assign(new Error('PRIVATE_OVERSIZED_OBJECT'), { code: 'FILE_TOO_LARGE' }))
    await expect(getInvoiceDownload({ userId: f.ctx.userId }, invoice.id)).rejects.toMatchObject({ code: 'INVOICE_PDF_UNAVAILABLE' })
    const failed = await testDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(failed).toMatchObject({
      pdfStatus: 'FAILED', pdfAttempts: before.pdfAttempts, pdfErrorCode: 'PDF_STORAGE_FAILED',
      pdfNextAttemptAt: expect.any(Date), pdfKey: null, pdfSha256: null, pdfSizeBytes: null,
      invoiceNo: before.invoiceNo, invoiceSnapshot: before.invoiceSnapshot,
    })
    await testDb.invoice.update({ where: { id: invoice.id }, data: { pdfNextAttemptAt: new Date('2000-01-01T00:00:00Z') } })
    await processInvoicePdf(invoice.id)
    expect(await testDb.invoice.findUnique({ where: { id: invoice.id } })).toMatchObject({
      pdfStatus: 'READY', pdfAttempts: before.pdfAttempts + 1, invoiceNo: before.invoiceNo,
    })
    expect(await testDb.invoice.count()).toBe(1)
  })
})
