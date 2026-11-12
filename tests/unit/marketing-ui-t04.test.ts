// @vitest-environment jsdom
import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketingPreferences } from '@/components/privacy/MarketingPreferences'
import { button, checkbox, click, copy, render, state, unmount } from '../helpers/marketing-ui-t04'

const io = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: io.refresh }) }))
vi.mock('@/server/actions/marketing-consent', () => ({ setMarketingConsentAction: io.save }))
beforeEach(() => { vi.clearAllMocks(); io.save.mockResolvedValue({ ok: true, data: {} }) })
afterEach(unmount)

for (const locale of ['zh', 'en'] as const) {
  describe(locale + ' independent weekly email preference', () => {
    it('starts unchecked and idle without invoking an action', async () => {
      await render(createElement(MarketingPreferences, { locale, audience: 'student', uiState: state }), locale)
      expect(checkbox().checked).toBe(false)
      expect(button(copy(locale).marketing.save).disabled).toBe(true)
      expect(document.querySelector('a')?.getAttribute('href')).toBe('/' + locale + '/legal/privacy')
      expect(io.save).not.toHaveBeenCalled()
    })
    it('requires an explicit checked choice then sends only grant and current version', async () => {
      await render(createElement(MarketingPreferences, { locale, audience: 'student', uiState: state }), locale)
      await click(checkbox())
      expect(io.save).not.toHaveBeenCalled()
      await click(button(copy(locale).marketing.save))
      expect(io.save).toHaveBeenCalledExactlyOnceWith({ granted: true, submittedVersion: state.legalVersion })
      expect(checkbox().checked).toBe(false)
      expect(button(copy(locale).marketing.withdraw).disabled).toBe(false)
      expect(document.body.textContent).toContain(copy(locale).marketing.saved)
      expect(io.refresh).toHaveBeenCalledOnce()
    })
    it('keeps employer preference personal and shows the recipient and quota disclosure', async () => {
      await render(createElement(MarketingPreferences, { locale, audience: 'employer', uiState: state }), locale)
      expect(document.body.textContent).toContain(copy(locale).marketing.employerDescription)
      expect(document.body.textContent).toContain(copy(locale).marketing.independent)
      await click(checkbox()); await click(button(copy(locale).marketing.save))
      expect(io.save.mock.calls[0]).toEqual([{ granted: true, submittedVersion: state.legalVersion }])
    })
    it('withdraws a historical grant with gate off and broken legal metadata', async () => {
      await render(createElement(MarketingPreferences, { locale, audience: 'employer', uiState: { available: false, consentGranted: true, legalVersion: null } }), locale)
      expect(checkbox().checked).toBe(false); expect(checkbox().disabled).toBe(true)
      expect(button(copy(locale).marketing.withdraw).disabled).toBe(false)
      await click(button(copy(locale).marketing.withdraw))
      expect(io.save).toHaveBeenCalledExactlyOnceWith({ granted: false })
      expect(document.body.textContent).toContain(copy(locale).marketing.withdrawn)
      expect([...document.querySelectorAll('button')].some(item => item.textContent === copy(locale).marketing.withdraw)).toBe(false)
    })
    it('does not enable a new grant without an available current version', async () => {
      await render(createElement(MarketingPreferences, { locale, audience: 'student', uiState: { ...state, available: false, legalVersion: null } }), locale)
      await click(checkbox()); await click(button(copy(locale).marketing.save))
      expect(checkbox().checked).toBe(false); expect(io.save).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain(copy(locale).marketing.unavailable)
    })
    it('requires a new unchecked choice when the legal version changes', async () => {
      await render(createElement(MarketingPreferences, { locale, audience: 'student', uiState: state }), locale)
      await click(checkbox())
      await render(createElement(MarketingPreferences, { locale, audience: 'student', uiState: { ...state, legalVersion: 'synthetic-v2' } }), locale)
      expect(checkbox().checked).toBe(false); expect(button(copy(locale).marketing.save).disabled).toBe(true)
      await click(checkbox()); await click(button(copy(locale).marketing.save))
      expect(io.save).toHaveBeenCalledExactlyOnceWith({ granted: true, submittedVersion: 'synthetic-v2' })
    })
    it('shows safe version mismatch text and clears the old checked choice', async () => {
      io.save.mockResolvedValue({ ok: false, code: 'VERSION_MISMATCH', message: 'PRIVATE_PROVIDER_TOKEN' })
      await render(createElement(MarketingPreferences, { locale, audience: 'student', uiState: state }), locale)
      await click(checkbox()); await click(button(copy(locale).marketing.save))
      expect(checkbox().checked).toBe(false)
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy(locale).marketing.error.version)
      expect(document.body.innerHTML).not.toContain('PRIVATE_PROVIDER_TOKEN')
      expect(io.refresh).toHaveBeenCalledOnce()
    })
    it('keeps a failed withdrawal available for explicit retry and hides raw failures', async () => {
      io.save.mockRejectedValueOnce(new Error('PRIVATE_EMAIL_ADDRESS'))
      await render(createElement(MarketingPreferences, { locale, audience: 'student', uiState: { ...state, consentGranted: true } }), locale)
      await click(button(copy(locale).marketing.withdraw))
      expect(button(copy(locale).marketing.withdraw).disabled).toBe(false)
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy(locale).marketing.error.generic)
      expect(document.body.innerHTML).not.toContain('PRIVATE_EMAIL_ADDRESS')
      await click(button(copy(locale).marketing.withdraw))
      expect(io.save).toHaveBeenCalledTimes(2)
    })
  })
}

describe('preference lifecycle boundaries', () => {
  it('deduplicates same-tick saves and displays busy state', async () => {
    let finish!: (value: { ok: true; data: object }) => void
    io.save.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await render(createElement(MarketingPreferences, { locale: 'en', audience: 'student', uiState: state }))
    await click(checkbox())
    await act(async () => { button(copy('en').marketing.save).click(); button(copy('en').marketing.save).click() })
    expect(io.save).toHaveBeenCalledOnce(); expect(button(copy('en').marketing.save).disabled).toBe(true)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    await act(async () => finish({ ok: true, data: {} }))
  })
  it('ignores a stale grant response after bootstrap metadata changes', async () => {
    let finish!: (value: { ok: true; data: object }) => void
    io.save.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await render(createElement(MarketingPreferences, { locale: 'en', audience: 'student', uiState: state }))
    await click(checkbox()); await click(button(copy('en').marketing.save))
    await render(createElement(MarketingPreferences, { locale: 'en', audience: 'student', uiState: { ...state, available: false, legalVersion: null } }))
    await act(async () => finish({ ok: true, data: {} }))
    expect(document.body.textContent).not.toContain(copy('en').marketing.saved)
    expect(document.body.textContent).not.toContain(copy('en').marketing.recorded)
    expect(io.refresh).toHaveBeenCalledOnce()
  })
  it('does not refresh or render a completion after unmount', async () => {
    let finish!: (value: { ok: true; data: object }) => void
    io.save.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await render(createElement(MarketingPreferences, { locale: 'en', audience: 'student', uiState: state }))
    await click(checkbox()); await click(button(copy('en').marketing.save)); await unmount()
    await act(async () => finish({ ok: true, data: {} }))
    expect(io.refresh).not.toHaveBeenCalled(); expect(document.body.textContent).toBe('')
  })
  it('keeps SSR controls disabled then enables withdrawal after hydration without an action', async () => {
    const providerProps = { locale: 'en', messages: copy('en'), timeZone: 'Asia/Kuala_Lumpur',
      children: createElement(MarketingPreferences, { locale: 'en', audience: 'student', uiState: { available: false, consentGranted: true, legalVersion: null } }) }
    const node = createElement(NextIntlClientProvider, providerProps)
    const container = document.createElement('div'); container.innerHTML = renderToString(node); document.body.append(container)
    let root: Root | undefined
    try {
      expect([...container.querySelectorAll<HTMLButtonElement>('button')].every(item => item.disabled)).toBe(true)
      expect(io.save).not.toHaveBeenCalled()
      await act(async () => { root = hydrateRoot(container, node) })
      expect(button(copy('en').marketing.withdraw).disabled).toBe(false)
      expect(io.save).not.toHaveBeenCalled()
    } finally { if (root) await act(async () => root!.unmount()); container.remove() }
  })
})
