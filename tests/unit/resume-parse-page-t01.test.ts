// @vitest-environment jsdom
import { act, createElement, isValidElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ResumePage from '@/app/[locale]/s/resume/page'
import { ResumeParsePanel } from '@/components/resume/ResumeParsePanel'
import { messages, resumeId } from '../helpers/resume-parse-ui-t01'

const io = vi.hoisted(() => ({ auth: vi.fn(), profile: vi.fn(), state: vi.fn(), locale: 'en' as 'en' | 'zh' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/authz', () => ({ requireStudent: io.auth }))
vi.mock('@/server/db', () => ({ db: { studentProfile: { findUnique: io.profile } } }))
vi.mock('@/server/services/resume-parsing', () => ({ getResumeParseUiState: io.state }))
vi.mock('@/server/actions/resume', () => ({ setPrimaryResume: vi.fn(), deleteResume: vi.fn() }))
vi.mock('@/server/actions/resume-parsing', () => ({
  setResumeParseConsentAction: vi.fn(), requestResumeParseAction: vi.fn(), getResumeParseDraftAction: vi.fn(),
  confirmResumeParseAction: vi.fn(), discardResumeParseDraftAction: vi.fn(),
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => messages(io.locale).resume[key as keyof ReturnType<typeof messages>['resume']] }))
let root: Root
let container: HTMLDivElement
const oldAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
afterAll(() => { if (oldAct === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldAct) })
beforeEach(() => {
  vi.clearAllMocks()
  io.auth.mockResolvedValue({ userId: 'synthetic-student' })
  io.state.mockResolvedValue({ available: false, consentGranted: false, legalVersion: null })
  io.profile.mockResolvedValue({ resumes: [{ id: resumeId, fileName: 'SYNTHETIC.pdf', sizeBytes: 100, pageCount: 1,
    isPrimary: true, createdAt: new Date('2026-11-10T00:00:00Z'), storageKey: 'PRIVATE_KEY', parsedJson: 'PRIVATE_DRAFT' }] })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
function panelProps(node: ReactNode): Record<string, unknown> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const found = panelProps(child); if (found) return found } }
  if (!isValidElement<{ children?: ReactNode }>(node)) return
  if (node.type === ResumeParsePanel) return node.props as Record<string, unknown>
  return panelProps(node.props.children)
}
describe('resume page safe AI integration', () => {
  for (const locale of ['zh', 'en'] as const) {
    it(locale + ' retains ordinary upload and manual editing when the feature is disabled', async () => {
      io.locale = locale
      const node = await ResumePage({ params: Promise.resolve({ locale }) })
      const projected = panelProps(node)
      expect(projected?.resumes).toEqual([{ id: resumeId, fileName: 'SYNTHETIC.pdf', createdAt: '2026-11-10T00:00:00.000Z' }])
      expect(JSON.stringify(projected)).not.toMatch(/PRIVATE_KEY|PRIVATE_DRAFT/)
      const providerProps = { locale, messages: messages(locale), children: node }
      await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
      expect(document.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe('.pdf,application/pdf')
      expect([...document.querySelectorAll('button')].some(button => button.textContent === messages(locale).resume.uploadButton && !button.disabled)).toBe(true)
      expect(document.querySelector('a[href="/' + locale + '/s/profile"]')).not.toBeNull()
      expect(document.body.textContent).toContain(messages(locale).resumeParse.unavailable)
      expect(io.state).toHaveBeenCalledExactlyOnceWith({ userId: 'synthetic-student' })
    })
  }
})
