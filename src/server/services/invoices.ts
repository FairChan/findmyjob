import 'server-only'
import type { Invoice } from '@prisma/client'
import { z } from 'zod'
import { db } from '../db'
import { AppError, NotFoundError, ValidationError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import {
  INVOICE_FONT_VERSION, INVOICE_NUMBER_SCOPE, INVOICE_TEMPLATE_VERSION,
  invoiceSnapshotSchema, type InvoiceSnapshot,
} from '../lib/invoice-snapshot'
import { logAudit } from './audit'
import { commercialSnapshotSchema } from './billing'
import { getSetting } from './settings'
import { configuredInvoiceIssuerSchema } from '../lib/invoice-settings'

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 }
const COUNTER_MAX = 9_223_372_036_854_775_807n
const idSchema = z.string().min(1).max(200).refine(value => value.trim().length > 0)

/**
 * Internal recovery/settlement entry; call only after the payment transaction commits.
 * This function only issues and queues. A separately scheduled worker renders the PDF.
 */
export async function ensureInvoiceForPaidOrder(orderId: string): Promise<Invoice> {
  if (!idSchema.safeParse(orderId).success) throw new ValidationError('Invalid invoice input')
  // Resolve only the lock key outside the transaction; all facts are re-read after CREDIT.
  const reference = await db.order.findUnique({ where: { id: orderId }, select: { companyId: true } })
  if (!reference) throw new NotFoundError('Order not found')

  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, reference.companyId)
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        invoice: true,
        company: { select: { legalName: true, ssmRegNo: true, address: true } },
      },
    })
    if (!order || order.companyId !== reference.companyId) throw new NotFoundError('Order not found')
    // Legacy and modern invoices are both immutable, independent of current configuration.
    if (order.invoice) return order.invoice

    const commercial = commercialSnapshotSchema.safeParse(order.commercialSnapshot)
    if (order.status !== 'PAID' || !order.paidAt || !Number.isFinite(order.paidAt.getTime())
      || !commercial.success || commercial.data.plan.id !== order.planId
      || commercial.data.plan.kind !== order.kind || commercial.data.money.currency !== order.currency
      || commercial.data.money.payableSen !== order.amountSen
      || commercial.data.money.discountSen !== order.discountSen) {
      throw new AppError('Paid order facts are unavailable', 'INVOICE_ORDER_FACTS_INVALID', 409)
    }
    const issuer = configuredInvoiceIssuerSchema.safeParse(
      await getSetting<unknown>('billing.invoiceIssuer', null, { tx, fresh: true }),
    )
    if (!issuer.success) {
      throw new AppError('Invoice issuer is not configured', 'INVOICE_ISSUER_NOT_CONFIGURED', 503)
    }

    const issuedAt = new Date()
    const frozen = commercial.data
    // Use the longest possible number before taking the global lock, so all ordinary
    // validation and the full serialized byte budget have already passed by that point.
    const draft = invoiceSnapshotSchema.safeParse({
      schemaVersion: 1,
      templateVersion: INVOICE_TEMPLATE_VERSION,
      fontAssetVersion: INVOICE_FONT_VERSION,
      invoiceNo: `${INVOICE_NUMBER_SCOPE}-${COUNTER_MAX}`,
      issuedAt: issuedAt.toISOString(),
      orderId: order.id,
      orderNo: order.orderNo,
      paidAt: order.paidAt.toISOString(),
      issuer: {
        legalName: issuer.data.legalName,
        address: issuer.data.address,
        registrationNo: issuer.data.registrationNo,
        configVersion: issuer.data.version,
      },
      buyer: {
        legalName: order.company.legalName,
        ssmRegNo: order.company.ssmRegNo,
        address: order.company.address,
      },
      item: {
        planCode: frozen.plan.code,
        kind: frozen.plan.kind,
        nameZh: frozen.plan.nameZh,
        nameEn: frozen.plan.nameEn,
        quantity: 1,
      },
      money: frozen.money,
      tax: { status: 'NOT_CONFIGURED', registrationNo: null, rate: null, amountSen: null },
    })
    if (!draft.success) {
      throw new AppError('Invoice snapshot is invalid', 'INVOICE_SNAPSHOT_INVALID', 409)
    }

    await lockXact(tx, LOCK_NS.INVOICE_NUMBER, INVOICE_NUMBER_SCOPE)
    let counter = await tx.invoiceCounter.findUnique({ where: { scope: INVOICE_NUMBER_SCOPE } })
    if (!counter) {
      // Never infer a historical series or restart at one in a nonempty invoice table.
      const historical = await tx.invoice.findFirst({ select: { id: true } })
      if (historical) {
        throw new AppError('Invoice counter requires initialization', 'INVOICE_COUNTER_NOT_INITIALIZED', 503)
      }
      counter = await tx.invoiceCounter.create({ data: { scope: INVOICE_NUMBER_SCOPE, lastValue: 0n } })
    }
    if (counter.lastValue < 0n || counter.lastValue >= COUNTER_MAX) {
      throw new AppError('Invoice counter is unavailable', 'INVOICE_COUNTER_UNAVAILABLE', 503)
    }
    const allocated = await tx.invoiceCounter.update({
      where: { scope: INVOICE_NUMBER_SCOPE },
      data: { lastValue: { increment: 1n } },
    })
    const invoiceNo = `${INVOICE_NUMBER_SCOPE}-${allocated.lastValue.toString().padStart(8, '0')}`
    const invoiceSnapshot: InvoiceSnapshot = { ...draft.data, invoiceNo }
    const invoice = await tx.invoice.create({
      data: {
        orderId: order.id, invoiceNo, issuedAt, invoiceSnapshot,
        einvoiceRef: null, pdfKey: null, pdfStatus: 'QUEUED', pdfAttempts: 0,
        pdfNextAttemptAt: issuedAt, pdfLeaseToken: null, pdfLeaseExpiresAt: null,
        pdfErrorCode: null, pdfSha256: null, pdfSizeBytes: null,
      },
    })
    await logAudit({
      action: 'invoice.issue',
      targetType: 'Invoice',
      targetId: invoice.id,
      metadata: { orderId: order.id, invoiceNo, schemaVersion: invoiceSnapshot.schemaVersion },
    }, tx)
    return invoice
  }, TRANSACTION_OPTIONS)
}
