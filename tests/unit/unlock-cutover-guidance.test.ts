// @vitest-environment jsdom
/**
 * T06 guidance. Real UnlockButton, Dialog and React; only the
 * server action and router boundary are isolated. Server role/setting wiring
 * is covered separately; these props do not prove authorization.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UnlockButton, type UnlockButtonLabels } from '@/components/talent/UnlockButton'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'

const mocks = vi.hoisted(() => ({ unlock: vi.fn(), refresh: vi.fn() }))
vi.mock('@/server/actions/unlock', () => ({ unlockStudentAction: mocks.unlock }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

const COPY = {
  zh: { purchase: '购买点数', contact: '请联系企业所有者购买点数。' },
  en: { purchase: 'Buy credits', contact: 'Ask your company owner to purchase credits.' },
} as const
type Locale = keyof typeof COPY
// Candidate presentation-only prop. The page supplies a localized first-party
// href only for OWNER while sales are enabled; no role or price is trusted here.
type Advice = { text: string; href?: string }
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
  mocks.unlock.mockReset().mockResolvedValue({ ok: false, code: 'INSUFFICIENT_CREDITS' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

function labels(language: Locale, pilot = false): UnlockButtonLabels {
  const t = (language === 'zh' ? zh : en).talentDetail
  return {
    button: t.unlockButton.replace('{cost}', '1'), confirmTitle: t.unlockConfirmTitle,
    confirmDesc: t.unlockConfirmDesc, confirmCost: t.unlockConfirmCost.replace('{cost}', '1'),
    confirmOk: t.unlockConfirmOk, confirmCancel: t.unlockConfirmCancel,
    errorInsufficient: pilot ? t.unlockErrorInsufficientPilot : t.unlockErrorInsufficient,
    errorRateLimit: t.unlockErrorRateLimit, errorGeneric: t.unlockErrorGeneric,
  }
}
async function mount(language: Locale, advice?: Advice, pilot = false) {
  // Structural props keep the current component import compilable, while a
  // missing advice UI must fail behavioral assertions once these tests are run.
  const props = { studentId: 'synthetic-student', labels: labels(language, pilot), insufficientCreditsAdvice: advice }
  await act(async () => root.render(createElement(UnlockButton, props)))
}
function button(text: string) {
  // Radix portals render outside the root container.
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text)
  if (!found) throw new Error('Button not found: ' + text)
  return found
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
async function attempt(language: Locale) {
  await click(button(labels(language).button))
  await click(button(labels(language).confirmOk))
}
function adviceLink(language: Locale) {
  return document.querySelector<HTMLAnchorElement>('a[href="/' + language + '/e/billing"]')
}

for (const language of ['zh', 'en'] as const) {
  describe(language + ' insufficient-credit cutover advice', () => {
    it('offers an explicit localized purchase link to OWNER only after an insufficient-credit response', async () => {
      await mount(language, { text: COPY[language].purchase, href: '/' + language + '/e/billing' })
      expect(adviceLink(language)).toBeNull()
      await attempt(language)
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(labels(language).errorInsufficient)
      expect(adviceLink(language)?.textContent).toBe(COPY[language].purchase)
      expect(mocks.unlock).toHaveBeenCalledExactlyOnceWith({ studentId: 'synthetic-student' })
      expect(mocks.refresh).not.toHaveBeenCalled()
    })

    it('shows contact-owner guidance without a purchase link for a non-owner member', async () => {
      await mount(language, { text: COPY[language].contact })
      await attempt(language)
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(COPY[language].contact)
      expect(adviceLink(language)).toBeNull()
      expect(document.querySelector('[role="dialog"] a')).toBeNull()
    })

    it('retains the next-month pilot message without a purchase action while sales are disabled', async () => {
      await mount(language, undefined, true)
      await attempt(language)
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(labels(language, true).errorInsufficient)
      expect(document.querySelector('[role="dialog"] a')).toBeNull()
    })

    it.each(['RATE_LIMITED', 'INTERNAL_ERROR'] as const)('does not suggest purchasing credits for %s', async (code) => {
      mocks.unlock.mockResolvedValueOnce({ ok: false, code })
      await mount(language, { text: COPY[language].purchase, href: '/' + language + '/e/billing' })
      await attempt(language)
      const expected = code === 'RATE_LIMITED' ? labels(language).errorRateLimit : labels(language).errorGeneric
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(expected)
      expect(adviceLink(language)).toBeNull()
    })
  })
}
