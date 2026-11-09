// @vitest-environment jsdom
/**
 * UI contract. Real forms, React and next-intl; actions/router mocked.
 * No external checkout, provider, database or authorization proof is claimed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import { CreateOrderForm } from '@/app/[locale]/e/billing/new/create-order-form'
import { StripeCheckoutForm } from '@/app/[locale]/e/billing/[orderId]/stripe-checkout-form'
import type { OrderQuoteV1 } from '@/server/services/billing'

const mocks = vi.hoisted(() => ({ create: vi.fn(), quote: vi.fn(), start: vi.fn(), push: vi.fn() }))
vi.mock('@/server/actions/billing', () => ({
  createOrderAction: mocks.create, quoteOrderAction: mocks.quote, startStripeCheckoutAction: mocks.start,
}))
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  Link: ({ href, children, ...props }: React.ComponentProps<'a'>) => createElement('a', { href, ...props }, children),
}))

const COPY = {
  en: { method: 'Payment method', bank: 'Bank transfer', stripe: 'Card or FPX (Stripe)', start: 'Continue to secure checkout', open: 'Open secure checkout' },
  zh: { method: '付款方式', bank: '银行转账', stripe: '银行卡或 FPX（Stripe）', start: '继续安全结账', open: '打开安全结账页面' },
} as const
type Locale = keyof typeof COPY
const quote: OrderQuoteV1 = {
  version: 1,
  plan: { id: 'synthetic-plan', code: 'SYNTHETIC_PACK', kind: 'CREDIT_PACK', nameZh: '合成点数包', nameEn: 'Synthetic credit pack', sourceUpdatedAt: '2026-01-01T00:00:00.000Z' },
  money: { currency: 'MYR', listPriceSen: 299901, discountSen: 149950, payableSen: 149951 },
  delivery: { credits: 10, subscription: null }, promotion: null,
}
const bank = { bankName: 'SYNTHETIC BANK', accountName: 'SYNTHETIC ACCOUNT', accountNumber: '001234567', instructions: 'Synthetic test instructions' }
const orderId = 'synthetic-order'
const checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_synthetic'
const leaked = 'SYNTHETIC_PRIVATE_PROVIDER_MESSAGE'
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
  mocks.create.mockReset().mockResolvedValue({ ok: true, data: { orderId, orderNo: 'SYNTHETIC-001' } })
  mocks.quote.mockReset().mockResolvedValue({ ok: true, data: quote })
  mocks.start.mockReset().mockResolvedValue({ ok: true, data: { orderId, checkoutUrl } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

async function mount(language: Locale, child: React.ReactNode) {
  const providerProps = { locale: language, messages: language === 'zh' ? zh : en, timeZone: 'Asia/Kuala_Lumpur', children: child }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
}
function button(name: string) {
  const result = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === name)
  if (!result) throw new Error('Button not found: ' + name)
  return result
}
function method(value: 'BANK_TRANSFER' | 'STRIPE') {
  const result = container.querySelector<HTMLInputElement>('input[type="radio"][name="method"][value="' + value + '"]')
  if (!result) throw new Error('Payment method radio not found')
  return result
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
async function submit(form: HTMLFormElement) {
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
function form(testId: string) {
  const result = container.querySelector<HTMLFormElement>('form[data-testid="' + testId + '"]')
  if (!result) throw new Error('Form not found: ' + testId)
  return result
}
function assertNoProviderLeak() {
  expect(container.innerHTML).not.toContain(leaked)
  expect(container.querySelector('input[name="companyId"],input[name="amountSen"],input[name="sessionId"],input[name="successUrl"]')).toBeNull()
}

for (const language of ['zh', 'en'] as const) {
  describe(language + ' payment choice and recoverable hosted checkout', () => {
    const c = COPY[language]
    const t = (language === 'zh' ? zh : en).billing

    it('labels bank/Stripe choices without creating an order or starting checkout on render/change', async () => {
      await mount(language, createElement(CreateOrderForm, { initialQuote: quote, bank }))
      expect(form('billing-quote').querySelector('fieldset legend')?.textContent).toBe(c.method)
      expect(method('BANK_TRANSFER').labels?.[0].textContent).toBe(c.bank)
      expect(method('STRIPE').labels?.[0].textContent).toBe(c.stripe)
      expect(method('BANK_TRANSFER').checked).toBe(true)
      await click(method('STRIPE'))
      expect(method('STRIPE').checked).toBe(true)
      expect(container.querySelector('[data-testid="quote-payable"]')?.textContent).toBe('MYR 1,499.51')
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.start).not.toHaveBeenCalled()
    })

    it('submits the complete accepted quote and selected Stripe method, then navigates only to local detail', async () => {
      await mount(language, createElement(CreateOrderForm, { initialQuote: quote, bank }))
      await click(method('STRIPE'))
      await click(button(t.create))
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ planId: quote.plan.id, method: 'STRIPE', acceptedQuote: quote })
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/e/billing/' + orderId)
      expect(mocks.start).not.toHaveBeenCalled()
      assertNoProviderLeak()
    })

    it('preserves the existing bank branch and allows Stripe when bank details are unavailable', async () => {
      await mount(language, createElement(CreateOrderForm, { initialQuote: quote, bank: null }))
      expect(button(t.create).disabled).toBe(true)
      await click(method('STRIPE'))
      expect(button(t.create).disabled).toBe(false)
      await click(method('BANK_TRANSFER'))
      expect(button(t.create).disabled).toBe(true)
      await mount(language, createElement(CreateOrderForm, { initialQuote: quote, bank }))
      await click(button(t.create))
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ planId: quote.plan.id, method: 'BANK_TRANSFER', acceptedQuote: quote })
      expect(mocks.start).not.toHaveBeenCalled()
    })

    it('retains the selected method and displayed quote on stale rejection and refreshes only explicitly', async () => {
      mocks.create.mockResolvedValueOnce({ ok: false, code: 'CONFLICT', message: leaked })
      await mount(language, createElement(CreateOrderForm, { initialQuote: quote, bank }))
      await click(method('STRIPE')); await click(button(t.create))
      expect(method('STRIPE').checked).toBe(true)
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.quoteChanged)
      expect(container.querySelector('[data-testid="quote-payable"]')?.textContent).toBe('MYR 1,499.51')
      expect(mocks.quote).not.toHaveBeenCalled()
      expect(mocks.push).not.toHaveBeenCalled()
      await click(button(t.refreshQuote))
      expect(mocks.quote).toHaveBeenCalledExactlyOnceWith({ planId: quote.plan.id })
      expect(method('STRIPE').checked).toBe(true)
      expect(mocks.create).toHaveBeenCalledTimes(1)
      assertNoProviderLeak()
    })

    it('does not start on render and serializes explicit start/retry for the same order', async () => {
      let resolve!: (value: unknown) => void
      mocks.start.mockImplementationOnce(() => new Promise((finish) => { resolve = finish }))
      await mount(language, createElement(StripeCheckoutForm, { orderId }))
      expect(mocks.start).not.toHaveBeenCalled()
      const start = button(c.start)
      await click(start)
      expect(start.disabled).toBe(true)
      await submit(form('stripe-checkout-form'))
      expect(mocks.start).toHaveBeenCalledExactlyOnceWith({ orderId, locale: language })
      await act(async () => resolve({ ok: false, code: 'PAYMENT_UNAVAILABLE', message: leaked }))
      expect(button(c.start).disabled).toBe(false)
      expect(container.querySelector('[role="alert"]')?.textContent?.length).toBeGreaterThan(0)
      expect(container.querySelector('a[href^="https://checkout.stripe.com"]')).toBeNull()
      button(c.start).focus()
      expect(document.activeElement).toBe(button(c.start))
      await click(button(c.start))
      expect(mocks.start).toHaveBeenCalledTimes(2)
      expect(mocks.start.mock.calls[1]).toEqual([{ orderId, locale: language }])
      const link = container.querySelector<HTMLAnchorElement>('a[href="' + checkoutUrl + '"]')
      expect(link?.textContent).toBe(c.open)
      expect(document.activeElement).toBe(link)
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.push).not.toHaveBeenCalled()
      assertNoProviderLeak()
    })

    it('handles transport failure without fabricating payment success or losing the retry control', async () => {
      mocks.start.mockRejectedValueOnce(new Error(leaked))
      await mount(language, createElement(StripeCheckoutForm, { orderId }))
      await click(button(c.start))
      expect(button(c.start).disabled).toBe(false)
      expect(container.querySelector('[role="alert"]')?.textContent?.length).toBeGreaterThan(0)
      expect(container.querySelector('a[href^="https://checkout.stripe.com"]')).toBeNull()
      expect(mocks.create).not.toHaveBeenCalled()
      assertNoProviderLeak()
    })

    it.each(['FORBIDDEN', 'NOT_FOUND', 'FEATURE_DISABLED', 'PAYMENT_REJECTED'])('shows a safe %s error without a checkout link', async (code) => {
      mocks.start.mockResolvedValue({ ok: false, code, message: leaked })
      await mount(language, createElement(StripeCheckoutForm, { orderId }))
      await click(button(c.start))
      expect(container.querySelector('[role="alert"]')?.textContent?.length).toBeGreaterThan(0)
      expect(container.querySelector('a[href^="https://checkout.stripe.com"]')).toBeNull()
      expect(mocks.create).not.toHaveBeenCalled()
      assertNoProviderLeak()
    })
  })
}

describe('checkout destination defense', () => {
  it.each([
    'javascript:alert(1)', 'http://checkout.stripe.com/pay/a', '//checkout.stripe.com/pay/a',
    'https://checkout.stripe.com.attacker.invalid/pay/a', 'https://other.stripe.com/pay/a',
    'https://user:pass@checkout.stripe.com/pay/a', 'https://checkout.stripe.com:444/pay/a',
  ])('does not render an untrusted destination: %s', async (url) => {
    mocks.start.mockResolvedValue({ ok: true, data: { orderId, checkoutUrl: url } })
    await mount('en', createElement(StripeCheckoutForm, { orderId }))
    await click(button(COPY.en.start))
    expect(Array.from(container.querySelectorAll('a')).some((link) => link.getAttribute('href') === url)).toBe(false)
    expect(container.querySelector('[role="alert"]')?.textContent?.length).toBeGreaterThan(0)
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
