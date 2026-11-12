import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const faults = vi.hoisted(() => ({ afterInsert: false, afterAudit: false }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: async () => undefined }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb.$extends({ query: { invoice: {
    async create({ args, query }) {
      const row = await query(args)
      if (faults.afterInsert) throw new Error('synthetic failure after Invoice insert')
      return row
    },
  } } }) }
})
vi.mock('@/server/services/audit', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/services/audit')>()
  return { ...actual, logAudit: async (...args: Parameters<typeof actual.logAudit>) => {
    await actual.logAudit(...args)
    if (faults.afterAudit && args[0].targetType === 'Invoice') {
      throw new Error('synthetic failure after invoice audit insert')
    }
  } }
})
vi.mock('@/lib/storage', () => ({ getObjectBytes: vi.fn(), putObject: vi.fn(), deleteAllVersions: vi.fn() }))

import { setupTestDb, testDb } from '../setup/db'
import { PROOF_BYTES, setting, billingFixture, awaitingOrder } from '../helpers/billing-t02'
import { confirmBankOrder, getMyOrder } from '@/server/services/billing'
import {
  BUYER_ADDRESS, BUYER_NAME, INVOICE_SCOPE, ISSUER_SETTING, ISSUE_ACTION, SYNTHETIC_ISSUER,
  configureIssuer, counterState, deferred, financialState, issue, paidUnissuedFixture,
} from '../helpers/invoices-t05'
import { getObjectBytes } from '@/lib/storage'
import { ensureInvoiceForPaidOrder } from '@/server/services/invoices'
import { getSetting } from '@/server/services/settings'
import { LOCK_NS, lockXact } from '@/server/lib/advisory-locks'
import { AppError } from '@/server/errors'

setupTestDb()
beforeEach(() => {
  vi.clearAllMocks()
  faults.afterInsert = false
  faults.afterAudit = false
  vi.mocked(getObjectBytes).mockResolvedValue(PROOF_BYTES)
})

describe('T05 issuance uses committed financial facts and real transactions', () => {
  it('returns only four safe invoice fields in the order detail even when private delivery metadata exists', async () => {
    const f = await paidUnissuedFixture()
    const issued = await issue(f)
    await testDb.invoice.update({ where: { id: issued.id }, data: {
      pdfKey: 'invoices/PRIVATE_DTO_SENTINEL.pdf', pdfSha256: 'a'.repeat(64), pdfSizeBytes: 300,
      pdfLeaseToken: 'PRIVATE_LEASE_SENTINEL', einvoiceRef: 'PRIVATE_EINVOICE_SENTINEL',
    } })
    const detail = await getMyOrder(f.ctx, { orderId: f.order.id })
    expect(detail.invoice).toEqual({
      id: issued.id, invoiceNo: issued.invoiceNo, issuedAt: issued.issuedAt.toISOString(), pdfStatus: 'QUEUED',
    })
    expect(Object.keys(detail.invoice!).sort()).toEqual(['id', 'invoiceNo', 'issuedAt', 'pdfStatus'])
    const serialized = JSON.stringify(detail)
    for (const privateValue of ['PRIVATE_DTO_SENTINEL', 'PRIVATE_LEASE_SENTINEL', 'PRIVATE_EINVOICE_SENTINEL', SYNTHETIC_ISSUER.legalName]) {
      expect(serialized).not.toContain(privateValue)
    }
  })

  it('commits payment, subscription and credits when issuer configuration is absent', async () => {
    const f = await paidUnissuedFixture()
    const before = await financialState(f)
    expect(before.order).toMatchObject({ status: 'PAID', amountSen: 299900, paidAt: expect.any(Date) })
    expect(before.subscriptions).toHaveLength(1)
    expect(before.wallet).toMatchObject({ balance: 120 })
    expect(before.ledger.filter(row => row.refId === f.order.id)).toHaveLength(1)
    await expect(ensureInvoiceForPaidOrder(f.order.id)).rejects.toMatchObject({ code: 'INVOICE_ISSUER_NOT_CONFIGURED' })
    expect(await testDb.invoice.count()).toBe(0)
    expect(await counterState()).toEqual([])
    expect(await financialState(f)).toEqual(before)
  })

  it('captures Chinese legal headings at issuance and retains the discounted net amount', async () => {
    const f = await paidUnissuedFixture(true)
    const before = await financialState(f)
    const row = await issue(f)
    expect(f.order).toMatchObject({ amountSen: 149950, discountSen: 149950 })
    expect(row).toMatchObject({
      invoiceNo: 'FMJ-INV-00000001', einvoiceRef: null, pdfStatus: 'QUEUED', pdfAttempts: 0,
      pdfKey: null, pdfLeaseToken: null,
      invoiceSnapshot: {
        schemaVersion: 1, invoiceNo: row.invoiceNo, issuedAt: row.issuedAt.toISOString(),
        orderId: f.order.id, orderNo: f.order.orderNo, paidAt: f.order.paidAt?.toISOString(),
        buyer: { legalName: BUYER_NAME, address: BUYER_ADDRESS, ssmRegNo: null },
        issuer: { legalName: SYNTHETIC_ISSUER.legalName, registrationNo: null },
        item: { planCode: f.plan.code, nameZh: f.plan.nameZh, nameEn: f.plan.nameEn, kind: 'PLAN', quantity: 1 },
        money: { currency: 'MYR', listPriceSen: 299900, discountSen: 149950, payableSen: 149950 },
        tax: { status: 'NOT_CONFIGURED', registrationNo: null, rate: null, amountSen: null },
      },
    })
    const json = JSON.stringify(row.invoiceSnapshot)
    expect(json).not.toContain('不得替代法定抬头')
    expect(json).not.toContain(f.order.proofKey)
    expect(json).not.toContain('accountNumber')
    expect(await counterState()).toMatchObject([{ scope: INVOICE_SCOPE, lastValue: 1n }])
    expect(await testDb.auditLog.findMany({ where: { action: ISSUE_ACTION } })).toMatchObject([
      { targetType: 'Invoice', targetId: row.id },
    ])
    expect(await financialState(f)).toEqual(before)
  })

  it('uses frozen commercial facts and current buyer heading when issuance is delayed', async () => {
    const f = await paidUnissuedFixture()
    await testDb.company.update({ where: { id: f.ctx.companyId }, data: { legalName: '付款后开票前的新法定抬头' } })
    await testDb.plan.update({ where: { id: f.plan.id }, data: { nameZh: '已停售名称', priceSen: 1, isActive: false, isPublic: false } })
    await setting('billing.enabled', false)
    const row = await issue(f)
    expect(row.invoiceSnapshot).toMatchObject({
      buyer: { legalName: '付款后开票前的新法定抬头' },
      item: { nameZh: f.plan.nameZh, nameEn: f.plan.nameEn },
      money: { listPriceSen: 299900, payableSen: 299900 },
    })
  })

  it('returns the original invoice after buyer, plan, issuer and sales settings change', async () => {
    const f = await paidUnissuedFixture()
    const original = await issue(f)
    await testDb.company.update({ where: { id: f.ctx.companyId }, data: { legalName: '后来更名', address: '后来地址', isActive: false } })
    await testDb.plan.update({ where: { id: f.plan.id }, data: { nameZh: '后来商品名', priceSen: 1, isActive: false } })
    await setting('billing.enabled', false)
    await testDb.systemSetting.deleteMany({ where: { key: ISSUER_SETTING } })
    await ensureInvoiceForPaidOrder(f.order.id)
    expect(await testDb.invoice.findUnique({ where: { id: original.id } })).toEqual(original)
    expect(await counterState()).toMatchObject([{ lastValue: 1n }])
    expect(await testDb.auditLog.count({ where: { action: ISSUE_ACTION } })).toBe(1)
  })

  it('allows the internal recovery path to issue an already paid inactive company order', async () => {
    const f = await paidUnissuedFixture()
    await testDb.company.update({ where: { id: f.ctx.companyId }, data: { isActive: false } })
    expect(await issue(f)).toMatchObject({ orderId: f.order.id, invoiceNo: 'FMJ-INV-00000001' })
  })

  it('does not use a cached issuer value after the authoritative setting is removed', async () => {
    const f = await paidUnissuedFixture()
    await configureIssuer()
    await getSetting(ISSUER_SETTING, SYNTHETIC_ISSUER)
    await testDb.systemSetting.deleteMany({ where: { key: ISSUER_SETTING } })
    // Deliberately do not clear the process settings cache.
    await expect(ensureInvoiceForPaidOrder(f.order.id)).rejects.toMatchObject({ code: 'INVOICE_ISSUER_NOT_CONFIGURED' })
    expect(await counterState()).toEqual([])
    expect(await testDb.invoice.count()).toBe(0)
  })

  it.each(['PENDING', 'AWAITING_CONFIRMATION', 'CANCELLED', 'REFUNDED'] as const)(
    'does not allocate an invoice for status %s', async status => {
      const f = await paidUnissuedFixture()
      await testDb.order.update({ where: { id: f.order.id }, data: { status } })
      await configureIssuer()
      await expect(ensureInvoiceForPaidOrder(f.order.id)).rejects.toBeInstanceOf(AppError)
      expect(await testDb.invoice.count()).toBe(0)
      expect(await counterState()).toEqual([])
    },
  )

  it.each(['missing-snapshot', 'wrong-version', 'amount-mismatch', 'missing-paid-at', 'non-MYR'])(
    'rejects inconsistent paid facts before numbering: %s', async variant => {
      const f = await paidUnissuedFixture()
      if (variant === 'missing-snapshot') await testDb.order.update({ where: { id: f.order.id }, data: { commercialSnapshot: Prisma.DbNull } })
      if (variant === 'wrong-version') await testDb.order.update({ where: { id: f.order.id }, data: { commercialSnapshot: { schemaVersion: 999 } } })
      if (variant === 'amount-mismatch') await testDb.order.update({ where: { id: f.order.id }, data: { amountSen: f.order.amountSen + 1 } })
      if (variant === 'missing-paid-at') await testDb.order.update({ where: { id: f.order.id }, data: { paidAt: null } })
      if (variant === 'non-MYR') await testDb.order.update({ where: { id: f.order.id }, data: { currency: 'USD' } })
      await configureIssuer()
      await expect(ensureInvoiceForPaidOrder(f.order.id)).rejects.toBeInstanceOf(AppError)
      expect(await testDb.invoice.count()).toBe(0)
      expect(await counterState()).toEqual([])
    },
  )

  it.each(['afterInsert', 'afterAudit'] as const)('rolls back number, invoice and audit after %s failure', async failure => {
    const first = await paidUnissuedFixture()
    const second = await paidUnissuedFixture()
    await issue(first)
    const counters = await counterState()
    const before = await financialState(second)
    faults[failure] = true
    try {
      await expect(ensureInvoiceForPaidOrder(second.order.id)).rejects.toThrow('synthetic failure')
    } finally {
      faults[failure] = false
    }
    expect(await counterState()).toEqual(counters)
    expect(await testDb.invoice.count()).toBe(1)
    expect(await testDb.invoice.findUnique({ where: { orderId: second.order.id } })).toBeNull()
    expect(await testDb.auditLog.count({ where: { action: ISSUE_ACTION } })).toBe(1)
    expect(await financialState(second)).toEqual(before)
    await ensureInvoiceForPaidOrder(second.order.id)
    expect(await testDb.invoice.findUnique({ where: { orderId: second.order.id } })).toMatchObject({ invoiceNo: 'FMJ-INV-00000002' })
  })

  it('serializes many concurrent attempts for the same order into one invoice and one audit', async () => {
    const f = await paidUnissuedFixture()
    await configureIssuer()
    const before = await financialState(f)
    await Promise.all(Array.from({ length: 6 }, () => ensureInvoiceForPaidOrder(f.order.id)))
    expect(await testDb.invoice.findMany()).toMatchObject([{ orderId: f.order.id, invoiceNo: 'FMJ-INV-00000001' }])
    expect(await counterState()).toMatchObject([{ lastValue: 1n }])
    expect(await testDb.auditLog.count({ where: { action: ISSUE_ACTION } })).toBe(1)
    expect(await financialState(f)).toEqual(before)
  })

  it('gives distinct companies contiguous unique numbers under concurrent issuance', async () => {
    // Fixture creation intentionally stays sequential: each resets shared synthetic settings.
    const fixtures = []
    for (let i = 0; i < 5; i++) fixtures.push(await paidUnissuedFixture())
    await configureIssuer()
    await Promise.all(fixtures.flatMap(f => [ensureInvoiceForPaidOrder(f.order.id), ensureInvoiceForPaidOrder(f.order.id)]))
    const rows = await testDb.invoice.findMany({ orderBy: { invoiceNo: 'asc' } })
    expect(rows.map(row => row.invoiceNo)).toEqual([
      'FMJ-INV-00000001', 'FMJ-INV-00000002', 'FMJ-INV-00000003', 'FMJ-INV-00000004', 'FMJ-INV-00000005',
    ])
    expect(new Set(rows.map(row => row.orderId))).toEqual(new Set(fixtures.map(f => f.order.id)))
    expect(await counterState()).toMatchObject([{ lastValue: 5n }])
    expect(await testDb.auditLog.count({ where: { action: ISSUE_ACTION } })).toBe(5)
  })

  it('keeps decimal numbering exact beyond Number.MAX_SAFE_INTEGER', async () => {
    const first = await paidUnissuedFixture()
    const second = await paidUnissuedFixture()
    // Synthetic formatting boundary only; this is not a historical migration recipe.
    await testDb.invoiceCounter.create({ data: { scope: INVOICE_SCOPE, lastValue: 9007199254740991n } })
    const a = await issue(first)
    const b = await issue(second)
    expect([a.invoiceNo, b.invoiceNo]).toEqual(['FMJ-INV-9007199254740992', 'FMJ-INV-9007199254740993'])
    expect(await counterState()).toMatchObject([{ lastValue: 9007199254740993n }])
  })

  it('rolls back initial counter creation when the first invoice insert fails', async () => {
    const f = await paidUnissuedFixture()
    await configureIssuer()
    faults.afterInsert = true
    try {
      await expect(ensureInvoiceForPaidOrder(f.order.id)).rejects.toThrow('synthetic failure')
    } finally {
      faults.afterInsert = false
    }
    expect(await counterState()).toEqual([])
    expect(await testDb.invoice.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: ISSUE_ACTION } })).toBe(0)
    expect(await issue(f)).toMatchObject({ invoiceNo: 'FMJ-INV-00000001' })
  })

  it('holds CREDIT before waiting for the real global number transaction lock', async () => {
    const f = await paidUnissuedFixture()
    await configureIssuer()
    const locked = deferred<void>()
    const release = deferred<void>()
    const blocker = testDb.$transaction(async tx => {
      await lockXact(tx, LOCK_NS.INVOICE_NUMBER, INVOICE_SCOPE)
      locked.resolve()
      await release.promise
    }, { timeout: 10_000 })
    await Promise.race([locked.promise, blocker])
    const issuing = ensureInvoiceForPaidOrder(f.order.id).then(
      () => ({ ok: true }), error => ({ ok: false, error }),
    )
    try {
      await vi.waitFor(async () => {
        const [row] = await testDb.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_locks waiting
          WHERE waiting.locktype = 'advisory' AND NOT waiting.granted
            AND waiting.classid = ${LOCK_NS.INVOICE_NUMBER}::oid
            AND waiting.objid = hashtext(${INVOICE_SCOPE})::oid
            AND EXISTS (
              SELECT 1 FROM pg_locks held
              WHERE held.pid = waiting.pid AND held.locktype = 'advisory' AND held.granted
                AND held.classid = ${LOCK_NS.CREDIT}::oid
                AND held.objid = hashtext(${f.ctx.companyId})::oid
            )
        `
        expect(row.waiting).toBeGreaterThan(0)
      }, { timeout: 3000, interval: 20 })
    } finally {
      release.resolve()
      await blocker
      await issuing
    }
    expect(await issuing).toMatchObject({ ok: true })
    expect(await testDb.invoice.count()).toBe(1)
  })

  it('issues after a new bank settlement commits and replays without another number or financial entry', async () => {
    const f = await billingFixture()
    const pending = await awaitingOrder(f)
    await configureIssuer()
    const input = { orderId: pending.id, receivedAmountSen: pending.amountSen, note: 'SYNTHETIC TEST ONLY: invoice delivery' }
    await confirmBankOrder(f.adminCtx, input)
    const paid = await testDb.order.findUniqueOrThrow({ where: { id: pending.id } })
    const paidFixture = { ...f, order: paid }
    const invoice = await testDb.invoice.findUnique({ where: { orderId: paid.id } })
    expect(invoice).toMatchObject({ invoiceNo: 'FMJ-INV-00000001', pdfStatus: 'QUEUED' })
    const before = await financialState(paidFixture)
    await expect(confirmBankOrder(f.adminCtx, input)).resolves.toMatchObject({ alreadyPaid: true })
    expect(await testDb.invoice.findUnique({ where: { orderId: paid.id } })).toEqual(invoice)
    expect(await counterState()).toMatchObject([{ lastValue: 1n }])
    expect(await financialState(paidFixture)).toEqual(before)
  })

  it('keeps a successful payment when post-commit invoice audit fails and recovers on replay', async () => {
    const f = await billingFixture()
    const pending = await awaitingOrder(f)
    await configureIssuer()
    const input = { orderId: pending.id, receivedAmountSen: pending.amountSen, note: 'SYNTHETIC TEST ONLY: failed invoice audit' }
    faults.afterAudit = true
    try {
      await expect(confirmBankOrder(f.adminCtx, input)).resolves.toMatchObject({ alreadyPaid: false })
    } finally {
      faults.afterAudit = false
    }
    const paid = await testDb.order.findUniqueOrThrow({ where: { id: pending.id } })
    const paidFixture = { ...f, order: paid }
    const before = await financialState(paidFixture)
    expect(before.order.status).toBe('PAID')
    expect(before.ledger.filter(row => row.refId === paid.id)).toHaveLength(1)
    expect(await counterState()).toEqual([])
    expect(await testDb.invoice.count()).toBe(0)
    await expect(confirmBankOrder(f.adminCtx, input)).resolves.toMatchObject({ alreadyPaid: true })
    expect(await testDb.invoice.findUnique({ where: { orderId: paid.id } })).toMatchObject({ invoiceNo: 'FMJ-INV-00000001' })
    expect(await financialState(paidFixture)).toEqual(before)
  })

  it('refuses to guess a new counter when historical invoices exist', async () => {
    const first = await paidUnissuedFixture()
    const second = await paidUnissuedFixture()
    const original = await issue(first)
    await testDb.invoiceCounter.deleteMany()
    const before = await financialState(second)
    await expect(ensureInvoiceForPaidOrder(second.order.id)).rejects.toMatchObject({ code: 'INVOICE_COUNTER_NOT_INITIALIZED' })
    expect(await counterState()).toEqual([])
    expect(await testDb.invoice.findMany()).toEqual([original])
    expect(await financialState(second)).toEqual(before)
  })

  it.each([-1n, 9223372036854775807n])('refuses unavailable counter %s without modifying payment or numbering', async lastValue => {
    const f = await paidUnissuedFixture()
    await configureIssuer()
    await testDb.invoiceCounter.create({ data: { scope: INVOICE_SCOPE, lastValue } })
    const counter = await counterState()
    const before = await financialState(f)
    await expect(ensureInvoiceForPaidOrder(f.order.id)).rejects.toMatchObject({ code: 'INVOICE_COUNTER_UNAVAILABLE' })
    expect(await counterState()).toEqual(counter)
    expect(await testDb.invoice.count()).toBe(0)
    expect(await financialState(f)).toEqual(before)
  })
})
