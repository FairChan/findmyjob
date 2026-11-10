// @vitest-environment jsdom
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentPrivacyPage from '@/app/[locale]/s/privacy/page'
import EmployerPreferencesPage from '@/app/[locale]/e/preferences/page'
import EmployerLayout from '@/app/[locale]/e/layout'
import { MarketingPreferences } from '@/components/privacy/MarketingPreferences'
import { StudentMatchingPanel } from '@/components/matching/StudentMatchingPanel'
import PrivacyCenter from '@/components/privacy/PrivacyCenter'
import { ForbiddenError } from '@/server/errors'
import { copy, state } from '../helpers/marketing-ui-t04'

const io = vi.hoisted(() => ({ student: vi.fn(), employer: vi.fn(), bootstrap: vi.fn(), locale: 'en' as 'en' | 'zh' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error('REDIRECT:' + path) }, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next-intl/server', () => ({ getLocale: async () => io.locale, getTranslations: async (namespace: string) => (key: string) => {
  const data = copy(io.locale) as unknown as Record<string, Record<string, string>>
  return data[namespace]?.[key] ?? key
} }))
vi.mock('@/server/authz', () => ({ requireStudent: io.student, requireEmployer: io.employer }))
vi.mock('@/server/db', () => ({ db: { notification: { count: async () => 0 } } }))
vi.mock('@/server/services/marketing-consent', () => ({ getMarketingUiState: io.bootstrap }))
vi.mock('@/server/services/semantic-matching', () => ({ getStudentMatchingUiState: async () => ({ available: false, consentGranted: false, consentCurrent: false, legalVersion: null }) }))
vi.mock('@/server/services/privacy', () => ({ getLatestTalentPoolConsent: async () => false, listBlockedCompanies: async () => [], getProfileViews: async () => [], getUnlocks: async () => [] }))
vi.mock('@/server/actions/marketing-consent', () => ({ setMarketingConsentAction: vi.fn() }))
vi.mock('@/server/actions/semantic-matching', () => ({ recommendJobsAction: vi.fn(), setMatchingConsentAction: vi.fn() }))
vi.mock('@/server/actions/privacy', () => ({ setVisibilityAction: vi.fn(), addBlockedCompanyAction: vi.fn(), removeBlockedCompanyAction: vi.fn(), searchVerifiedCompaniesAction: vi.fn() }))
vi.mock('@/server/actions/data-rights', () => ({ requestExportAction: vi.fn(), requestDeletionAction: vi.fn() }))

function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...nodes(node.props.children)]
}
beforeEach(() => {
  vi.clearAllMocks()
  io.student.mockResolvedValue({ userId: 'synthetic-student' })
  io.employer.mockResolvedValue({ userId: 'synthetic-employer' })
  io.bootstrap.mockResolvedValue({ ...state, email: 'PRIVATE_EMAIL', token: 'PRIVATE_TOKEN', companyId: 'PRIVATE_COMPANY' })
})

describe('marketing preference server boundaries', () => {
  for (const locale of ['zh', 'en'] as const) {
    it(locale + ' preserves student matching and visibility controls beside separate marketing', async () => {
      io.locale = locale
      const tree = nodes(await StudentPrivacyPage())
      expect(tree.find(node => node.type === MarketingPreferences)?.props).toEqual({ locale, audience: 'student', uiState: state })
      expect(tree.find(node => node.type === StudentMatchingPanel)?.props.consentOnly).toBe(true)
      expect(tree.find(node => node.type === PrivacyCenter)?.props.initialVisible).toBe(false)
      expect(io.bootstrap).toHaveBeenCalledExactlyOnceWith({ userId: 'synthetic-student' })
    })
    it(locale + ' uses only employer identity and safe bootstrap for personal preferences', async () => {
      io.locale = locale
      const tree = nodes(await EmployerPreferencesPage())
      expect(tree.find(node => node.type === MarketingPreferences)?.props).toEqual({ locale, audience: 'employer', uiState: state })
      expect(io.bootstrap).toHaveBeenCalledExactlyOnceWith({ userId: 'synthetic-employer' })
      expect(io.employer).toHaveBeenCalledExactlyOnceWith(expect.any(Headers))
      expect(io.student).not.toHaveBeenCalled()
    })
    it(locale + ' keeps an employer layout entry without consulting company membership', async () => {
      io.locale = locale
      const tree = nodes(await EmployerLayout({ children: null, params: Promise.resolve({ locale }) }))
      const entry = tree.find(node => node.props.href === '/' + locale + '/e/preferences')
      expect(entry?.props.children).toBe(copy(locale).marketing.preferencesLink)
      expect(entry?.props.prefetch).toBe(false)
    })
  }
  it('stops an unauthenticated student before reading bootstrap', async () => {
    io.student.mockRejectedValue(new ForbiddenError())
    await expect(StudentPrivacyPage()).rejects.toThrow(ForbiddenError)
    expect(io.bootstrap).not.toHaveBeenCalled()
  })
  it('stops non-employers before reading personal bootstrap', async () => {
    io.employer.mockRejectedValue(new ForbiddenError())
    await expect(EmployerPreferencesPage()).rejects.toThrow(ForbiddenError)
    expect(io.bootstrap).not.toHaveBeenCalled()
  })
})
