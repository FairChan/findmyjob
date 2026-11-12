import { inspect } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const observed = vi.hoisted(() => ({ batch: vi.fn(), warn: vi.fn(), scanFailure: false }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: async () => undefined }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb.$extends({ query: { order: {
    async findMany({ args, query }) {
      if (observed.scanFailure) throw new Error('PRIVATE_SYNTHETIC_SCAN_FAILURE')
      return query(args)
    },
  } } }) }
})
vi.mock('@/server/services/invoice-delivery', () => ({
  processInvoicePdfBatch: observed.batch, processInvoicePdf: vi.fn(), getInvoiceDownload: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({ getObjectBytes: vi.fn(), putObject: vi.fn(), deleteAllVersions: vi.fn() }))
vi.mock('@/server/lib/logger', () => ({ logger: {
  warn: observed.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn(),
} }))

import { setupTestDb, testDb } from '../setup/db'
import { getObjectBytes } from '@/lib/storage'
import { getSetting } from '@/server/services/settings'
import { runInvoiceTasks } from '@/server/jobs/invoice-tasks'
import { PROOF_BYTES, setting } from '../helpers/billing-t02'
import {
  ISSUER_SETTING, SYNTHETIC_ISSUER, deferred, issue, paidUnissuedFixture, type PaidFixture,
} from '../helpers/invoices-t05'

setupTestDb()
beforeEach(() => {
  vi.resetAllMocks()
  observed.scanFailure = false
  observed.batch.mockResolvedValue(undefined)
  vi.mocked(getObjectBytes).mockResolvedValue(PROOF_BYTES)
})

// Deterministic valid cuid IDs isolate pagination order from timestamps. These
// rows represent synthetic committed paid facts; this test never settles them again.
async function recoveryOrders(f: PaidFixture, count: number, invalidCount = 0) {
  const ids = Array.from({ length: count }, (_, index) => 'c' + String(index + 1).padStart(24, '0'))
  await testDb.order.createMany({ data: ids.map((id, index) => ({
    id, orderNo: 'SYNTHETIC-T05-RECOVERY-' + id,
    companyId: f.ctx.companyId, planId: f.plan.id, kind: f.order.kind,
    amountSen: f.order.amountSen, discountSen: f.order.discountSen, currency: f.order.currency,
    status: 'PAID' as const, paidAt: f.order.paidAt, createdById: f.ctx.userId,
    commercialSnapshot: index < invalidCount ? Prisma.DbNull : f.order.commercialSnapshot as Prisma.InputJsonValue,
  })) })
  return ids
}

describe('T05 invoice runner recovery traversal', () => {
  it('reaches page two after the first 50 successful rows leave the missing-invoice filter', async () => {
    const f = await paidUnissuedFixture()
    const original = await issue(f)
    const ids = await recoveryOrders(f, 51)
    // Non-PAID rows and already issued rows are not recovery candidates.
    const unpaidId = 'c' + '9'.repeat(24)
    await testDb.order.create({ data: {
      id: unpaidId, orderNo: 'SYNTHETIC-T05-UNPAID', companyId: f.ctx.companyId, planId: f.plan.id,
      kind: f.order.kind, status: 'PENDING', amountSen: f.order.amountSen, createdById: f.ctx.userId,
    } })
    observed.batch.mockImplementationOnce(async () => {
      expect(await testDb.invoice.count({ where: { orderId: { in: ids } } })).toBe(51)
    })
    await runInvoiceTasks()
    expect(await testDb.invoice.findMany({ where: { orderId: { in: ids } }, orderBy: { orderId: 'asc' }, select: { orderId: true } }))
      .toEqual(ids.map(orderId => ({ orderId })))
    expect(await testDb.invoice.findUnique({ where: { orderId: unpaidId } })).toBeNull()
    expect(await testDb.invoice.findUnique({ where: { id: original.id } })).toEqual(original)
    expect(observed.batch).toHaveBeenCalledTimes(1)
  })

  it('passes 50 persistent bad historical rows, waits for PDF work, then reports controlled failure', async () => {
    const f = await paidUnissuedFixture()
    await issue(f)
    const ids = await recoveryOrders(f, 51, 50)
    const entered = deferred<void>()
    const release = deferred<void>()
    observed.batch.mockImplementationOnce(async () => { entered.resolve(); await release.promise })
    let finished = false
    const settled = Promise.allSettled([runInvoiceTasks()]).then(result => { finished = true; return result })
    try {
      await Promise.race([entered.promise, settled.then(() => { throw new Error('Runner skipped the PDF phase') })])
      expect(finished).toBe(false)
      expect(await testDb.invoice.count({ where: { orderId: { in: ids.slice(0, 50) } } })).toBe(0)
      expect(await testDb.invoice.findUnique({ where: { orderId: ids[50] } })).not.toBeNull()
    } finally {
      release.resolve()
      await settled
    }
    expect(await settled).toMatchObject([{ status: 'rejected', reason: { code: 'INVOICE_TASKS_FAILED', httpStatus: 503 } }])
    expect(observed.batch).toHaveBeenCalledTimes(1)
    expect(await testDb.order.count({ where: { id: { in: ids.slice(0, 50) }, invoice: null } })).toBe(50)
  })

  it.each(['missing', 'invalid'] as const)(
    'skips issuance with %s fresh issuer configuration while still processing queued PDFs', async variant => {
      const f = await paidUnissuedFixture()
      const queued = await issue(f)
      const [orderId] = await recoveryOrders(f, 1)
      await getSetting(ISSUER_SETTING, SYNTHETIC_ISSUER)
      if (variant === 'missing') await testDb.systemSetting.delete({ where: { key: ISSUER_SETTING } })
      else await setting(ISSUER_SETTING, { schemaVersion: 1, version: 'incomplete' })
      // No cache clearing: the runner must observe the authoritative configuration.
      observed.warn.mockClear()
      await runInvoiceTasks()
      expect(await testDb.invoice.findUnique({ where: { orderId } })).toBeNull()
      expect(await testDb.invoice.findUnique({ where: { id: queued.id } })).toEqual(queued)
      expect(observed.batch).toHaveBeenCalledTimes(1)
      expect(observed.warn).not.toHaveBeenCalled()
    },
  )

  it('keeps newly issued rows committed when the PDF batch fails and exposes only a fixed error', async () => {
    const f = await paidUnissuedFixture()
    await issue(f)
    const [orderId] = await recoveryOrders(f, 1)
    const secret = 'PRIVATE_SYNTHETIC_PDF_BATCH_FAILURE'
    observed.batch.mockRejectedValueOnce(new Error(secret))
    await expect(runInvoiceTasks()).rejects.toMatchObject({ code: 'INVOICE_TASKS_FAILED', httpStatus: 503 })
    expect(await testDb.invoice.findUnique({ where: { orderId } })).toMatchObject({ pdfStatus: 'QUEUED', pdfAttempts: 0 })
    expect(inspect(observed.warn.mock.calls, { depth: null })).not.toContain(secret)
    await runInvoiceTasks()
    expect(await testDb.invoice.count({ where: { orderId } })).toBe(1)
    expect(observed.batch).toHaveBeenCalledTimes(2)
  })

  it('still awaits the PDF batch after a candidate scan fails', async () => {
    const f = await paidUnissuedFixture()
    await issue(f)
    const [orderId] = await recoveryOrders(f, 1)
    observed.scanFailure = true
    try {
      await expect(runInvoiceTasks()).rejects.toMatchObject({ code: 'INVOICE_TASKS_FAILED', httpStatus: 503 })
    } finally {
      observed.scanFailure = false
    }
    expect(observed.batch).toHaveBeenCalledTimes(1)
    expect(await testDb.invoice.findUnique({ where: { orderId } })).toBeNull()
    expect(inspect(observed.warn.mock.calls, { depth: null })).not.toContain('PRIVATE_SYNTHETIC_SCAN_FAILURE')
  })
})
