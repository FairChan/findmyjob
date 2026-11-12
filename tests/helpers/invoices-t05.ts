import { confirmBankOrder } from '@/server/services/billing'
import { ensureInvoiceForPaidOrder } from '@/server/services/invoices'
import { processInvoicePdf } from '@/server/services/invoice-delivery'
import { clearSettingsCache } from '@/server/services/settings'
import { testDb } from '../setup/db'
import { awaitingOrder, billingFixture, foundingOffer, setting } from './billing-t02'

// Proposed wiring is collected in t05-test-contract.md; these are synthetic facts only.
export const ISSUER_SETTING = 'billing.invoiceIssuer'
export const INVOICE_SCOPE = 'FMJ-INV'
export const ISSUE_ACTION = 'invoice.issue'
export const PDF_MAX_BYTES = 8 * 1024 * 1024
export const BUYER_NAME = '合成测试华夏科技有限公司'
export const BUYER_ADDRESS = '合成测试地址吉隆坡一号'
export const SYNTHETIC_ISSUER = {
  schemaVersion: 1,
  version: 'synthetic-v1',
  legalName: 'SYNTHETIC 合成测试开票主体 TEST ONLY',
  address: '合成测试地址 TEST ONLY; not an operating address',
  registrationNo: null,
}

export async function configureIssuer() {
  await setting(ISSUER_SETTING, SYNTHETIC_ISSUER)
  clearSettingsCache()
}

export async function paidUnissuedFixture(discount = false) {
  const f = await billingFixture()
  // Exercise real post-payment issuance failure. Never add a production skip-invoice flag.
  await testDb.systemSetting.deleteMany({ where: { key: ISSUER_SETTING } })
  clearSettingsCache()
  await testDb.company.update({
    where: { id: f.ctx.companyId },
    data: {
      legalName: BUYER_NAME, address: BUYER_ADDRESS,
      displayNameZh: '不得替代法定抬头', displayNameEn: 'NOT THE LEGAL HEADING',
    },
  })
  if (discount) await foundingOffer(f)
  const pending = await awaitingOrder(f)
  await confirmBankOrder(f.adminCtx, {
    orderId: pending.id, receivedAmountSen: pending.amountSen,
    note: 'SYNTHETIC TEST ONLY: no external money moved',
  })
  const order = await testDb.order.findUniqueOrThrow({ where: { id: pending.id } })
  return { ...f, order }
}

export type PaidFixture = Awaited<ReturnType<typeof paidUnissuedFixture>>

export async function issue(f: PaidFixture) {
  await configureIssuer()
  await ensureInvoiceForPaidOrder(f.order.id)
  return testDb.invoice.findUniqueOrThrow({ where: { orderId: f.order.id } })
}

export async function financialState(f: PaidFixture) {
  return {
    order: await testDb.order.findUniqueOrThrow({ where: { id: f.order.id } }),
    wallet: await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } }),
    ledger: await testDb.creditLedger.findMany({
      where: { wallet: { companyId: f.ctx.companyId } }, orderBy: { id: 'asc' },
    }),
    subscriptions: await testDb.subscription.findMany({
      where: { companyId: f.ctx.companyId }, orderBy: { id: 'asc' },
    }),
  }
}

export async function counterState() {
  return testDb.invoiceCounter.findMany({ orderBy: { scope: 'asc' } })
}

export async function runPdf(invoiceId: string) {
  // Worker result/stats/throw policy is intentionally not frozen. Assert persisted outcomes.
  await Promise.allSettled([processInvoicePdf(invoiceId)])
  return testDb.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
}

export async function makePdfDue(invoiceId: string) {
  await testDb.invoice.update({
    where: { id: invoiceId }, data: { pdfNextAttemptAt: new Date('2000-01-01T00:00:00Z') },
  })
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
