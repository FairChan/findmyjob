// @vitest-environment jsdom
/**
 * Server-page/component boundary tests. Mock auth and read services,
 * never payment settlement. Browser/service suites prove the real OWNER boundary.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createTranslator, NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import OrderPage from '@/app/[locale]/e/billing/[orderId]/page'
import { ForbiddenError, NotFoundError } from '@/server/errors'
import type { OrderDetail } from '@/server/services/billing'

const mocks = vi.hoisted(() => ({ owner: vi.fn(), get: vi.fn(), start: vi.fn(), create: vi.fn(), refresh: vi.fn(), redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/server/authz', () => ({ requireCompanyMember: mocks.owner }))
vi.mock('@/server/services/billing', () => ({ getMyOrder: mocks.get }))
vi.mock('@/server/actions/billing', () => ({
  startStripeCheckoutAction: mocks.start, createOrderAction: mocks.create, attachBankProofAction: vi.fn(), cancelPendingOrderAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound, useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<'a'>) => createElement('a', { href, ...props }, children),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: 'zh' | 'en'; namespace: string }) =>
    createTranslator({ locale, messages: (locale === 'zh' ? zh : en) as AbstractIntlMessages, namespace }),
}))

type Locale = 'zh' | 'en'
type State = 'NOT_STARTED' | 'CREATING' | 'OPEN' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'RECONCILIATION_REQUIRED'
const ctx = { userId: 'synthetic-owner', companyId: 'synthetic-company', role: 'OWNER' }
interface FpxReceipt {
  createdAt: string; amountSen: number; currency: 'MYR'; orderNo: string
  sellerOrderNo: string | null; transactionId: string | null; bankName: string | null; status: 'succeeded'
}
const receipt: FpxReceipt = {
  createdAt: '2026-11-10T01:02:03.000Z', amountSen: 149951, currency: 'MYR' as const,
  orderNo: 'SYNTHETIC-ORDER-NO', sellerOrderNo: 'SYNTHETIC SELLER ORDER', transactionId: 'SYNTHETIC FPX TRANSACTION', bankName: 'SYNTHETIC FPX BANK', status: 'succeeded' as const,
}
const secrets = ['cs_test_PRIVATE', 'pi_PRIVATE', 'ch_PRIVATE', 'attempt_PRIVATE', 'idem_PRIVATE', 'client_secret_PRIVATE', 'sk_test_PRIVATE', 'other_company_PRIVATE']
const base: OrderDetail = {
  id: 'synthetic-order', orderNo: 'SYNTHETIC-ORDER-NO', kind: 'CREDIT_PACK', status: 'PENDING', paymentProvider: 'STRIPE', paymentMethod: null,
  amountSen: 149951, discountSen: 149950, currency: 'MYR', createdAt: '2026-11-10T00:00:00.000Z', paidAt: null, hasProof: false,
  plan: { id: 'synthetic-plan', code: 'SYNTHETIC_PACK', kind: 'CREDIT_PACK', nameZh: '合成点数包', nameEn: 'Synthetic credit pack', sourceUpdatedAt: '2026-01-01T00:00:00.000Z' },
  commercialSnapshot: null, bankTransfer: null, stripePayment: null, invoice: null,
}
let root: Root
let container: HTMLDivElement
const oldAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
afterAll(() => {
  if (oldAct === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldAct)
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.owner.mockReset().mockResolvedValue(ctx)
  mocks.get.mockReset().mockResolvedValue({ ...base, stripePayment: { state: 'NOT_STARTED', fpxReceipt: null } })
  mocks.redirect.mockImplementation(() => { throw new Error('LOCAL_REDIRECT') })
  mocks.notFound.mockImplementation(() => { throw new Error('LOCAL_NOT_FOUND') })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

async function page(language: Locale, query: Record<string, string> = {}) {
  // Future searchParams remains compatible with the existing page Props.
  const props = { params: Promise.resolve({ locale: language, orderId: base.id }), searchParams: Promise.resolve(query) }
  return OrderPage(props)
}
async function mount(language: Locale, query: Record<string, string> = {}) {
  const tree = await page(language, query)
  // Detect leaked read-service fields passed to client components before rendering.
  const serializedTree = JSON.stringify(tree)
  for (const secret of secrets) expect(serializedTree).not.toContain(secret)
  const providerProps = { locale: language, messages: language === 'zh' ? zh : en, timeZone: 'Asia/Kuala_Lumpur', children: tree as ReactNode }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
}
function setOrder(state: State, extra: Partial<OrderDetail> = {}, fpxReceipt: typeof receipt | null = null) {
  mocks.get.mockResolvedValue({
    ...base, ...extra, stripePayment: { state, fpxReceipt: fpxReceipt && { ...fpxReceipt, chargeId: secrets[2], secretKey: secrets[6] } },
    sessionId: secrets[0], paymentIntentId: secrets[1], chargeId: secrets[2], attemptId: secrets[3],
    idempotencyKey: secrets[4], clientSecret: secrets[5], secretKey: secrets[6], companyId: secrets[7],
  })
}

for (const language of ['zh', 'en'] as const) {
  describe(language + ' local Stripe order and minimal FPX receipt', () => {
    const copy = language === 'zh' ? zh.billing : en.billing

    it('reads the current OWNER order only and ignores forged success/session queries', async () => {
      setOrder('NOT_STARTED')
      await mount(language, { success: 'true', payment_status: 'paid', session_id: 'cs_test_untrusted_query' })
      expect(mocks.owner).toHaveBeenCalledWith('OWNER', expect.any(Headers))
      expect(mocks.get).toHaveBeenCalledExactlyOnceWith(ctx, { orderId: base.id })
      expect(container.querySelector('[data-testid="order-status"]')?.textContent).toBe(copy.pending)
      expect(container.querySelector('[data-testid="fpx-receipt"]')).toBeNull()
      expect(container.querySelector('[data-testid="payment-proof-form"]')).toBeNull()
      expect(container.querySelector('[data-testid="stripe-checkout-form"]')).not.toBeNull()
      expect(mocks.start).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
    })

    it.each(['CREATING', 'OPEN'] as const)('offers explicit same-order checkout recovery for %s', async (state) => {
      setOrder(state)
      await mount(language, { cancelled: 'true' })
      expect(container.querySelector('[data-testid="order-status"]')?.textContent).toBe(copy.pending)
      expect(container.querySelector('[data-testid="stripe-checkout-form"]')).not.toBeNull()
      expect(mocks.start).not.toHaveBeenCalled()
      expect(mocks.create).not.toHaveBeenCalled()
    })

    it.each(['PROCESSING', 'FAILED', 'EXPIRED', 'RECONCILIATION_REQUIRED'] as const)('does not reopen a payment attempt in %s', async (state) => {
      setOrder(state)
      await mount(language, { success: '1' })
      expect(container.querySelector('[data-testid="order-status"]')?.textContent).toBe(copy.pending)
      expect(container.querySelector('[data-testid="stripe-payment-state"]')?.textContent?.length).toBeGreaterThan(0)
      expect(container.querySelector('[data-testid="stripe-checkout-form"]')).toBeNull()
      expect(container.querySelector('[data-testid="payment-proof-form"]')).toBeNull()
      expect(container.querySelector('[data-testid="fpx-receipt"]')).toBeNull()
      expect(mocks.start).not.toHaveBeenCalled()
    })

    it('renders only required FPX receipt fields after a locally PAID FPX order', async () => {
      setOrder('SUCCEEDED', { status: 'PAID', paymentMethod: 'FPX', paidAt: receipt.createdAt }, receipt)
      await mount(language)
      expect(container.querySelector('[data-testid="order-status"]')?.textContent).toBe(copy.paid)
      const view = container.querySelector('[data-testid="fpx-receipt"]')
      expect(view).not.toBeNull()
      expect(view?.querySelectorAll('dt')).toHaveLength(6)
      expect(view?.querySelector('time')?.getAttribute('datetime')).toBe(receipt.createdAt)
      expect(view?.textContent).toContain('MYR 1,499.51')
      expect(view?.textContent).toContain(receipt.sellerOrderNo)
      expect(view?.textContent).toContain(receipt.transactionId)
      expect(view?.textContent).toContain(receipt.bankName)
      expect(container.querySelector('[data-testid="stripe-checkout-form"]')).toBeNull()
      for (const secret of secrets) expect(container.innerHTML).not.toContain(secret)
      expect(mocks.start).not.toHaveBeenCalled()
    })

    it.each(['CARD', null] as const)('does not render FPX details for actual payment method %s', async (paymentMethod) => {
      setOrder('SUCCEEDED', { status: 'PAID', paymentMethod, paidAt: receipt.createdAt }, receipt)
      await mount(language)
      expect(container.querySelector('[data-testid="fpx-receipt"]')).toBeNull()
      expect(container.textContent).not.toContain(receipt.transactionId)
      expect(container.querySelector('[data-testid="stripe-checkout-form"]')).toBeNull()
    })

    it('does not expose receipt fields for PENDING even if an inconsistent read DTO includes them', async () => {
      setOrder('PROCESSING', {}, receipt)
      await mount(language)
      expect(container.querySelector('[data-testid="fpx-receipt"]')).toBeNull()
      expect(container.textContent).not.toContain(receipt.transactionId)
      expect(container.querySelector('[data-testid="order-status"]')?.textContent).toBe(copy.pending)
    })

    it('keeps legitimate nullable FPX reference fields distinct from the local order number', async () => {
      setOrder('SUCCEEDED', { status: 'PAID', paymentMethod: 'FPX', paidAt: receipt.createdAt }, { ...receipt, sellerOrderNo: null, transactionId: null, bankName: null })
      await mount(language)
      const view = container.querySelector('[data-testid="fpx-receipt"]')
      const unavailable = language === 'zh' ? '暂未提供' : 'Not available'
      expect(view).not.toBeNull()
      expect(Array.from(view!.querySelectorAll('dd')).filter((item) => item.textContent === unavailable)).toHaveLength(3)
      expect(view?.textContent).not.toContain(receipt.orderNo)
      expect(container.querySelector('[data-testid="order-number"]')?.textContent).toBe(receipt.orderNo)
      expect(container.querySelector('[data-testid="order-status"]')?.textContent).toBe(copy.paid)
      expect(mocks.start).not.toHaveBeenCalled()
    })
  })
}

describe('page authorization routing', () => {
  it('does not read order or receipt data after OWNER authorization fails', async () => {
    mocks.owner.mockRejectedValue(new ForbiddenError('Synthetic denial'))
    await expect(page('en')).rejects.toThrow('LOCAL_REDIRECT')
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith('/en/login')
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('preserves not-found behavior for another company order, including a forged Session query', async () => {
    mocks.get.mockRejectedValue(new NotFoundError('Synthetic unavailable order'))
    await expect(page('zh', { session_id: 'cs_test_other_company' })).rejects.toThrow('LOCAL_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe('')
  })
})
