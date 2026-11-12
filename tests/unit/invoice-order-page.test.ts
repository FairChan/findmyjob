// @vitest-environment jsdom
// Auth/read boundaries are isolated; the order page and client invoice panel are real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import OrderPage from '@/app/[locale]/e/billing/[orderId]/page'
import type { OrderDetail } from '@/server/services/billing'
import { ForbiddenError, NotFoundError } from '@/server/errors'
import { invoice, messages, mount, orderId, privateText, setupUi, type Locale } from '../helpers/invoice-ui-t05'

const mocks = vi.hoisted(() => ({ owner: vi.fn(), get: vi.fn(), redirect: vi.fn(), notFound: vi.fn(), fetch: vi.fn(), action: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/server/authz', () => ({ requireCompanyMember: mocks.owner }))
vi.mock('@/server/services/billing', () => ({ getMyOrder: mocks.get }))
vi.mock('@/server/actions/billing', () => ({ startStripeCheckoutAction: mocks.action, attachBankProofAction: mocks.action, cancelPendingOrderAction: mocks.action }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children, ...props }: React.ComponentProps<'a'>) => createElement('a', { href, ...props }, children) }))
vi.mock('next-intl/server', () => ({ getTranslations: async ({ locale, namespace }: { locale: Locale; namespace: string }) => createTranslator({ locale, messages: messages(locale) as AbstractIntlMessages, namespace }) }))

setupUi()
const ctx = { userId: 'synthetic-owner', companyId: 'synthetic-company', role: 'OWNER' }
const base: OrderDetail = {
  id: orderId, orderNo: 'SYNTHETIC-ORDER-NO', kind: 'CREDIT_PACK', status: 'PAID', paymentProvider: 'BANK_TRANSFER', paymentMethod: 'BANK_TRANSFER',
  amountSen: 149951, discountSen: 149950, currency: 'MYR', createdAt: '2026-11-10T00:00:00.000Z', paidAt: invoice.issuedAt, hasProof: false,
  plan: null, commercialSnapshot: null, bankTransfer: null, stripePayment: null, invoice: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.owner.mockReset().mockResolvedValue(ctx)
  mocks.get.mockReset().mockResolvedValue(base)
  mocks.redirect.mockImplementation(() => { throw new Error('LOCAL_REDIRECT') })
  mocks.notFound.mockImplementation(() => { throw new Error('LOCAL_NOT_FOUND') })
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => vi.unstubAllGlobals())
async function page(locale: Locale) { return OrderPage({ params: Promise.resolve({ locale, orderId }) }) }
async function render(locale: Locale) {
  const tree = await page(locale)
  expect(JSON.stringify(tree)).not.toContain(privateText)
  await mount(locale, tree)
  expect(document.body.innerHTML).not.toContain(privateText)
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.action).not.toHaveBeenCalled()
}
for (const locale of ['zh', 'en'] as const) {
  describe(locale + ' paid order invoice view', () => {
    it('keeps a PAID order paid when issuance has not produced an invoice', async () => {
      await render(locale)
      expect(mocks.owner).toHaveBeenCalledWith('OWNER', expect.any(Headers))
      expect(mocks.get).toHaveBeenCalledExactlyOnceWith(ctx, { orderId })
      expect(document.querySelector('[data-testid="order-status"]')?.textContent).toBe(messages(locale).billing.paid)
      expect(document.querySelector('[data-testid="order-invoice"]')?.textContent).toContain(messages(locale).billingInvoice.notIssued)
      expect(document.querySelector('[data-testid="order-invoice"] button')).toBeNull()
    })
    it.each(['QUEUED', 'PROCESSING', 'FAILED', 'READY'] as const)('projects only the safe invoice DTO fields for %s', async (pdfStatus) => {
      mocks.get.mockResolvedValue({ ...base, invoice: { ...invoice, pdfStatus, invoiceSnapshot: privateText, pdfKey: privateText, pdfSha256: privateText, pdfErrorCode: privateText, href: 'https://attacker.invalid/' + privateText } })
      await render(locale)
      const panel = document.querySelector('[data-testid="order-invoice"]')
      expect(panel).not.toBeNull(); expect(panel?.textContent).toContain(invoice.invoiceNo)
      expect(panel?.querySelector('button') !== null).toBe(pdfStatus === 'READY')
      expect(document.querySelector('[data-testid="order-status"]')?.textContent).toBe(messages(locale).billing.paid)
      expect(panel?.querySelector('a')?.getAttribute('href')).toBe('/' + locale + '/e/billing/' + orderId)
    })
    it.each(['PENDING', 'AWAITING_CONFIRMATION', 'CANCELLED'] as const)('does not expose an inconsistent invoice on an unpaid %s order', async (status) => {
      mocks.get.mockResolvedValue({ ...base, status, paidAt: null, paymentProvider: 'STRIPE', paymentMethod: null, invoice: { ...invoice, invoiceNo: privateText } })
      await render(locale)
      expect(document.querySelector('[data-testid="order-invoice"]')).toBeNull()
    })
    it('keeps the FPX receipt distinct from the invoice and does not deduct the discount twice', async () => {
      mocks.get.mockResolvedValue({ ...base, paymentProvider: 'STRIPE', paymentMethod: 'FPX', invoice, stripePayment: { state: 'SUCCEEDED', fpxReceipt: {
        status: 'succeeded', createdAt: invoice.issuedAt, amountSen: base.amountSen, currency: 'MYR', orderNo: base.orderNo,
        sellerOrderNo: 'SYNTHETIC-FPX-ORDER', transactionId: 'SYNTHETIC-FPX-TX', bankName: 'SYNTHETIC BANK',
      } } })
      await render(locale)
      expect(document.querySelector('[data-testid="fpx-receipt"]')).not.toBeNull()
      expect(document.querySelector('[data-testid="order-invoice"]')).not.toBeNull()
      expect(document.querySelector('[data-testid="order-amount"]')?.textContent).toBe('MYR 1,499.51')
      expect(document.querySelector('[data-testid="stripe-checkout-form"]')).toBeNull()
    })
  })
}
it('does not read order or invoice data when current OWNER authorization fails', async () => {
  mocks.owner.mockRejectedValue(new ForbiddenError(privateText))
  await expect(page('en')).rejects.toThrow('LOCAL_REDIRECT')
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled()
})
it('keeps the existing not-found boundary for another company order', async () => {
  mocks.get.mockRejectedValue(new NotFoundError(privateText))
  await expect(page('zh')).rejects.toThrow('LOCAL_NOT_FOUND')
  expect(mocks.notFound).toHaveBeenCalledOnce(); expect(mocks.fetch).not.toHaveBeenCalled()
})
