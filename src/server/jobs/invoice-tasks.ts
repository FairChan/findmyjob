import 'server-only'
import { db } from '../db'
import { AppError } from '../errors'
import { configuredInvoiceIssuerSchema } from '../lib/invoice-settings'
import { logger } from '../lib/logger'
import { ensureInvoiceForPaidOrder } from '../services/invoices'
import { processInvoicePdfBatch } from '../services/invoice-delivery'
import { getSetting } from '../services/settings'

const BATCH_SIZE = 50

/**
 * Recover missing invoices from committed payments, then await one bounded PDF batch.
 * Individual services own their short transactions; this orchestration holds no locks.
 */
export async function runInvoiceTasks(): Promise<void> {
  let failed = false
  try {
    const issuer = configuredInvoiceIssuerSchema.safeParse(
      await getSetting<unknown>('billing.invoiceIssuer', null, { fresh: true }),
    )
    // Missing configuration must not prevent already issued invoices from rendering.
    if (issuer.success) {
      // Bound the tail for this invocation. Later payments are picked up next minute.
      const boundary = await db.order.findFirst({
        where: { status: 'PAID', invoice: null },
        orderBy: { id: 'desc' }, select: { id: true },
      })
      let cursor: string | undefined
      while (boundary) {
        const orders = await db.order.findMany({
          where: {
            status: 'PAID', invoice: null,
            id: { lte: boundary.id, ...(cursor ? { gt: cursor } : {}) },
          },
          orderBy: { id: 'asc' }, take: BATCH_SIZE, select: { id: true },
        })
        if (orders.length === 0) break
        for (const order of orders) {
          try {
            await ensureInvoiceForPaidOrder(order.id)
          } catch {
            failed = true
            logger.warn({ orderId: order.id, code: 'INVOICE_ISSUANCE_RECOVERY_FAILED' },
              'Invoice issuance recovery failed')
          }
        }
        // Advance even when every order in this page failed. Successful orders can
        // disappear from the filter, so an offset or first-page-only scan is unsafe.
        cursor = orders[orders.length - 1].id
        if (orders.length < BATCH_SIZE) break
      }
    }
  } catch {
    failed = true
    logger.warn({ code: 'INVOICE_RECOVERY_SCAN_FAILED' }, 'Invoice recovery scan failed')
  }

  // Always run this phase, even after issuance/config/scan failures. Delivery owns
  // the 50-row limit, persistent attempts, leases and terminal-state exclusions.
  try {
    await processInvoicePdfBatch()
  } catch {
    failed = true
    logger.warn({ code: 'INVOICE_PDF_BATCH_FAILED' }, 'Invoice PDF batch failed')
  }

  if (failed) throw new AppError('Invoice tasks failed', 'INVOICE_TASKS_FAILED', 503)
}
