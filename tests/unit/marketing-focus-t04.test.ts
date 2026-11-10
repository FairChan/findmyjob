// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketingPreferences } from '@/components/privacy/MarketingPreferences'
import { button, click, copy, render, unmount } from '../helpers/marketing-ui-t04'

const io = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: io.refresh }) }))
vi.mock('@/server/actions/marketing-consent', () => ({ setMarketingConsentAction: io.save }))
beforeEach(() => { vi.clearAllMocks(); io.save.mockResolvedValue({ ok: true, data: {} }) })
afterEach(unmount)

describe('T04 withdrawal completion focus', () => {
  for (const locale of ['zh', 'en'] as const) {
    it(locale + ': moves focus from the removed withdrawal button to the translated status', async () => {
      await render(createElement(MarketingPreferences, { locale, audience: 'student',
        uiState: { available: false, consentGranted: true, legalVersion: null } }), locale)
      const status = document.querySelector<HTMLElement>('[role="status"]')!
      expect(document.activeElement).not.toBe(status)
      const withdraw = button(copy(locale).marketing.withdraw)
      withdraw.focus()
      await click(withdraw)
      expect(io.save).toHaveBeenCalledExactlyOnceWith({ granted: false })
      expect(status.textContent).toBe(copy(locale).marketing.withdrawn)
      expect(document.activeElement).toBe(status)
      expect(status.tabIndex).toBe(-1)
      expect(status.getAttribute('aria-live')).toBe('polite')
      expect(withdraw.isConnected).toBe(false)
    })
  }
})
