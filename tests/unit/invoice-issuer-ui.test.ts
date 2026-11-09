// @vitest-environment jsdom
// Real forms and next-intl; read/auth/action boundaries mocked. No database or browser proof.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import { InvoiceIssuerForm } from '@/app/[locale]/admin/settings/invoice-issuer-form'
import AdminSettingsPage from '@/app/[locale]/admin/settings/page'
import { EMPTY_INVOICE_ISSUER } from '@/server/lib/invoice-settings'
import { setupUi, mount, messages, button, click, fill, submit } from '../helpers/entitlements-ui-t04'

const mocks = vi.hoisted(() => ({ save: vi.fn(), admin: vi.fn(), settings: vi.fn(), scalar: vi.fn(), locale: 'en' as 'zh' | 'en' }))
vi.mock('@/app/[locale]/admin/settings/actions', () => ({ saveInvoiceIssuerSettingsAction: mocks.save }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/server/authz', () => ({ requireAdmin: mocks.admin }))
vi.mock('@/server/services/admin-settings', () => ({ getAllSettings: mocks.settings }))
vi.mock('@/app/[locale]/admin/settings/bank-transfer-form', () => ({ BankTransferForm: () => null }))
vi.mock('@/app/[locale]/admin/settings/settings-form', () => ({ SettingsForm: (props: unknown) => { mocks.scalar(props); return null } }))
vi.mock('next-intl/server', () => ({ getTranslations: async (namespace: string) => createTranslator({
  locale: mocks.locale, messages: messages(mocks.locale) as AbstractIntlMessages, namespace,
}) }))

setupUi()
const initial = {
  schemaVersion: 1 as const, version: ' SYNTHETIC_VERSION_801 ', legalName: '  SYNTHETIC_ISSUER_802 法定 & Co  ',
  address: '  SYNTHETIC_ADDRESS_803\nSuite 2  ', registrationNo: '00000804',
}
const ctx = { userId: 'synthetic-admin' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.save.mockReset().mockResolvedValue({ ok: true, data: undefined })
  mocks.admin.mockReset().mockResolvedValue(ctx)
  mocks.settings.mockReset().mockResolvedValue([])
})
function field(name: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[name="' + name + '"]')
  if (!element) throw new Error('Missing issuer field: ' + name)
  return element
}
function form() {
  const element = document.querySelector<HTMLFormElement>('form[data-testid="invoice-issuer-settings"]')
  if (!element) throw new Error('Missing issuer form')
  return element
}

for (const locale of ['zh', 'en'] as const) {
  describe(locale + ' issuer settings UI', () => {
    beforeEach(() => { mocks.locale = locale })
    const t = messages(locale).adminInvoiceIssuer

    it('labels all controls, preserves legal text and saves the exact complete configuration', async () => {
      await mount(locale, createElement(InvoiceIssuerForm, { initialValue: initial }))
      expect(mocks.save).not.toHaveBeenCalled()
      for (const name of ['legalName', 'address', 'registrationNo', 'version'] as const) {
        expect(field(name).labels?.[0]?.textContent).toBe(t[name])
        expect(field(name).value).toBe(initial[name])
      }
      await click(button(t.saveIssuer))
      expect(mocks.save).toHaveBeenCalledExactlyOnceWith(initial)
      expect(document.querySelector('[role="status"]')?.textContent).toContain(t.issuerSaved)
    })

    it('keeps oversized text for correction, rejects partial data, and accepts clearing all fields', async () => {
      await mount(locale, createElement(InvoiceIssuerForm, { initialValue: initial }))
      const oversized = 'x'.repeat(201)
      expect(field('legalName').hasAttribute('maxlength')).toBe(false)
      await fill(field('legalName'), oversized)
      await submit(form())
      expect(field('legalName').value).toBe(oversized)
      expect(field('legalName').getAttribute('aria-invalid')).toBe('true')
      expect(document.activeElement).toBe(field('legalName'))
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(t.errorInvalid)
      expect(mocks.save).not.toHaveBeenCalled()
      await fill(field('legalName'), '')
      await submit(form())
      expect(mocks.save).not.toHaveBeenCalled()
      for (const name of ['address', 'registrationNo', 'version']) await fill(field(name), '')
      await submit(form())
      expect(mocks.save).toHaveBeenCalledExactlyOnceWith(EMPTY_INVOICE_ISSUER)
    })

    it('prevents duplicate submits and keeps input after a save failure for an explicit retry', async () => {
      let finish!: (value: unknown) => void
      mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      await mount(locale, createElement(InvoiceIssuerForm, { initialValue: initial }))
      await submit(form())
      expect(form().getAttribute('aria-busy')).toBe('true')
      expect(form().querySelector('fieldset')?.disabled).toBe(true)
      expect(button(t.saving).disabled).toBe(true)
      await submit(form())
      expect(mocks.save).toHaveBeenCalledTimes(1)
      await act(async () => finish({ ok: false, code: 'INTERNAL_ERROR', message: 'SYNTHETIC_PRIVATE_ERROR' }))
      expect(field('address').value).toBe(initial.address)
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(t.errorGeneric)
      expect(document.body.innerHTML).not.toContain('SYNTHETIC_PRIVATE_ERROR')
      expect(button(t.saveIssuer).disabled).toBe(false)
      await click(button(t.saveIssuer))
      expect(mocks.save).toHaveBeenCalledTimes(2)
    })

    it.each(['FORBIDDEN', 'TWO_FACTOR_REQUIRED'] as const)('shows safe %s recovery with a localized link', async code => {
      mocks.save.mockResolvedValueOnce({ ok: false, code, message: 'SYNTHETIC_PRIVATE_ERROR' })
      await mount(locale, createElement(InvoiceIssuerForm, { initialValue: initial }))
      await submit(form())
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(code === 'FORBIDDEN' ? t.errorForbidden : t.errorTwoFactor)
      expect(document.querySelector('a')?.getAttribute('href')).toBe('/' + locale + (code === 'FORBIDDEN' ? '/login' : '/two-factor/setup'))
      expect(field('legalName').value).toBe(initial.legalName)
      expect(document.body.innerHTML).not.toContain('SYNTHETIC_PRIVATE_ERROR')
    })

    it('wires the dedicated form and excludes issuer JSON from generic settings', async () => {
      const scalar = { key: 'billing.enabled', currentValue: false }
      mocks.settings.mockResolvedValueOnce([scalar, { key: 'billing.invoiceIssuer', currentValue: initial }])
      await mount(locale, await AdminSettingsPage())
      expect(mocks.admin).toHaveBeenCalledTimes(1)
      expect(mocks.settings).toHaveBeenCalledExactlyOnceWith(ctx)
      expect(mocks.scalar).toHaveBeenCalledWith({ settings: [scalar] })
      expect(field('legalName').value).toBe(initial.legalName)
      expect(mocks.save).not.toHaveBeenCalled()
    })

    it('uses a blank form for invalid persisted configuration without inventing an issuer', async () => {
      mocks.settings.mockResolvedValueOnce([{ key: 'billing.invoiceIssuer', currentValue: { legalName: 'SYNTHETIC_INVALID_PRIVATE_ISSUER' } }])
      await mount(locale, await AdminSettingsPage())
      for (const name of ['legalName', 'address', 'registrationNo', 'version']) expect(field(name).value).toBe('')
      expect(document.body.innerHTML).not.toContain('SYNTHETIC_INVALID_PRIVATE_ISSUER')
      expect(mocks.save).not.toHaveBeenCalled()
    })
  })
}
