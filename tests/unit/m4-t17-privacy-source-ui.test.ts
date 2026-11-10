// @vitest-environment jsdom
import { jsx } from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator, NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import zhMessages from '../../messages/zh.json'
import enMessages from '../../messages/en.json'

const mocks = vi.hoisted(() => ({
  locale: 'zh' as 'zh' | 'en',
  getUnlocks: vi.fn(),
}))

vi.mock('next-intl/server', () => ({
  getLocale: async () => mocks.locale,
  getTranslations: async (namespace: string) => createTranslator({
    locale: mocks.locale,
    messages: (mocks.locale === 'zh' ? zhMessages : enMessages) as AbstractIntlMessages,
    namespace,
  }),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/server/authz', () => ({
  requireStudent: async () => ({ userId: 'student-user' }),
}))
vi.mock('@/server/services/privacy', () => ({
  getLatestTalentPoolConsent: async () => true,
  listBlockedCompanies: async () => [],
  getProfileViews: async () => [],
  getUnlocks: mocks.getUnlocks,
}))
vi.mock('@/server/actions/privacy', () => ({
  setVisibilityAction: vi.fn(),
  addBlockedCompanyAction: vi.fn(),
  removeBlockedCompanyAction: vi.fn(),
  searchVerifiedCompaniesAction: vi.fn(),
}))
vi.mock('@/server/actions/data-rights', () => ({
  requestExportAction: vi.fn(),
  requestDeletionAction: vi.fn(),
}))
vi.mock('@/server/services/semantic-matching', () => ({
  getStudentMatchingUiState: async () => ({
    available: false, consentGranted: false, consentCurrent: false, legalVersion: null,
  }),
}))
vi.mock('@/server/actions/semantic-matching', () => ({
  recommendJobsAction: vi.fn(),
  setMatchingConsentAction: vi.fn(),
}))

import PrivacyPage from '@/app/[locale]/s/privacy/page'

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  mocks.locale = 'zh'
  mocks.getUnlocks.mockResolvedValue([
    {
      companyId: 'application-company',
      companyName: 'Application Company',
      unlockedAt: new Date('2026-11-05T01:00:00.000Z'),
      source: 'APPLICATION',
    },
    {
      companyId: 'credit-company',
      companyName: 'Credit Company',
      unlockedAt: new Date('2026-11-04T01:00:00.000Z'),
      source: 'CREDIT',
    },
  ])
})

describe('M4-T17: application unlock provenance reaches the real privacy UI', () => {
  it.each([
    ['zh', '投递自动授权'],
    ['en', 'Granted through an application'],
  ] as const)('%s distinguishes an application grant from a paid unlock', async (locale, label) => {
    mocks.locale = locale
    const page = await PrivacyPage()
    document.body.innerHTML = renderToStaticMarkup(jsx(NextIntlClientProvider, {
      locale,
      messages: (locale === 'zh' ? zhMessages : enMessages) as AbstractIntlMessages,
      timeZone: 'Asia/Kuala_Lumpur',
      now: new Date('2026-11-09T00:00:00.000Z'),
      children: page,
    }))

    const rows = Array.from(document.querySelectorAll('section[aria-labelledby="unlocks-heading"] li'))
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Application Company')
    expect(rows[0].textContent).toContain(label)
    expect(rows[1].textContent).toContain('Credit Company')
    expect(rows[1].textContent).not.toContain(label)
  })
})
