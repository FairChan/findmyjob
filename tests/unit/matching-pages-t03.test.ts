// @vitest-environment jsdom
import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentDashboardPage from '@/app/[locale]/s/page'
import PrivacyPage from '@/app/[locale]/s/privacy/page'
import CompanyJobsPage from '@/app/[locale]/e/jobs/page'
import JobRecommendationsPage from '@/app/[locale]/e/jobs/[id]/recommendations/page'
import { StudentMatchingPanel } from '@/components/matching/StudentMatchingPanel'
import { EmployerMatchingPanel } from '@/components/matching/EmployerMatchingPanel'
import { ForbiddenError, NotFoundError } from '@/server/errors'
import { copy, jobId, state } from '../helpers/matching-ui-t03'
const io = vi.hoisted(() => ({ auth: vi.fn(), verified: vi.fn(), bootstrap: vi.fn(), job: vi.fn(), jobs: vi.fn(), locale: 'en' as 'en' | 'zh' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') }, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children, ...props }: ComponentProps<'a'>) => createElement('a', { href, ...props }, children) }))
vi.mock('next-intl/server', () => ({ getLocale: async () => io.locale, getTranslations: async (namespace: string) => (key: string) => {
  const data = copy(io.locale) as unknown as Record<string, Record<string, string>>
  return data[namespace]?.[key] ?? key
} }))
vi.mock('@/server/authz', () => ({ requireStudent: io.auth, requireCompanyMember: io.auth, requireVerifiedCompany: io.verified }))
vi.mock('@/server/services/student-profile', () => ({ getDashboardData: async () => null }))
vi.mock('@/server/services/semantic-matching', () => ({ getStudentMatchingUiState: io.bootstrap }))
vi.mock('@/server/services/privacy', () => ({ getLatestTalentPoolConsent: async () => false, listBlockedCompanies: async () => [], getProfileViews: async () => [], getUnlocks: async () => [] }))
vi.mock('@/server/services/jobs', () => ({ getCompanyJob: io.job, listCompanyJobs: io.jobs }))
vi.mock('@/server/services/subscription-entitlements', () => ({ getCompanyEntitlementUsage: async () => ({}) }))
vi.mock('@/server/actions/semantic-matching', () => ({ recommendJobsAction: vi.fn(), recommendTalentsAction: vi.fn(), setMatchingConsentAction: vi.fn() }))
vi.mock('@/server/actions/privacy', () => ({ setVisibilityAction: vi.fn(), addBlockedCompanyAction: vi.fn(), removeBlockedCompanyAction: vi.fn(), searchVerifiedCompaniesAction: vi.fn() }))
vi.mock('@/server/actions/data-rights', () => ({ requestExportAction: vi.fn(), requestDeletionAction: vi.fn() }))
vi.mock('@/app/[locale]/e/jobs/actions', () => ({ copyJobAction: vi.fn(), closeJobAction: vi.fn() }))
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as ReactElement<Record<string, unknown>>, ...nodes(node.props.children)]
}
beforeEach(() => {
  vi.clearAllMocks()
  io.auth.mockResolvedValue({ userId: 'synthetic-user', companyId: 'synthetic-company', role: 'OWNER' })
  io.verified.mockResolvedValue({ userId: 'synthetic-employer', companyId: 'synthetic-company', role: 'OWNER' })
  io.bootstrap.mockResolvedValue(state)
  io.job.mockResolvedValue({ id: jobId, title: 'Synthetic owned job', status: 'PUBLISHED', deadline: null, description: 'PRIVATE_BODY', reviewNote: 'PRIVATE_REVIEW' })
  io.jobs.mockResolvedValue([])
})
describe('matching server-page boundaries', () => {
  for (const locale of ['zh', 'en'] as const) {
    it(locale + ' binds dashboard bootstrap to the authenticated student only', async () => {
      io.locale = locale
      const tree = nodes(await StudentDashboardPage({ params: Promise.resolve({ locale }) }))
      const panel = tree.find(node => node.type === StudentMatchingPanel)
      expect(panel?.props).toMatchObject({ locale, uiState: state })
      expect(panel?.props.consentOnly).toBeUndefined()
      expect(io.bootstrap).toHaveBeenCalledExactlyOnceWith({ userId: 'synthetic-user' })
    })
    it(locale + ' exposes separate matching consent without replacing privacy-center visibility', async () => {
      io.locale = locale
      const tree = nodes(await PrivacyPage())
      expect(tree.find(node => node.type === StudentMatchingPanel)?.props).toMatchObject({ locale, uiState: state, consentOnly: true })
      expect(tree.some(node => node.props.initialVisible === false && node.props.initialBlocked !== undefined)).toBe(true)
      expect(io.bootstrap).toHaveBeenCalledExactlyOnceWith({ userId: 'synthetic-user' })
    })
    it(locale + ' projects only owned published job id and title to the request panel', async () => {
      io.locale = locale
      const tree = nodes(await JobRecommendationsPage({ params: Promise.resolve({ locale, id: jobId }) }))
      const panel = tree.find(node => node.type === EmployerMatchingPanel)
      expect(panel?.props).toEqual({ locale, job: { id: jobId, title: 'Synthetic owned job' } })
      expect(JSON.stringify(panel?.props)).not.toMatch(/PRIVATE_BODY|PRIVATE_REVIEW/)
      expect(io.verified.mock.calls[0][0]).toBe('RECRUITER')
      expect(io.job).toHaveBeenCalledExactlyOnceWith({ userId: 'synthetic-employer', companyId: 'synthetic-company', role: 'OWNER' }, jobId)
    })
  }
  it.each(['DRAFT', 'CLOSED', 'PENDING_REVIEW', 'EXPIRED'])('rejects %s before displaying recommendation controls', async status => {
    io.job.mockResolvedValue({ id: jobId, title: 'Invalid source', status: status === 'EXPIRED' ? 'PUBLISHED' : status,
      deadline: status === 'EXPIRED' ? new Date('2000-01-01T00:00:00Z') : null })
    await expect(JobRecommendationsPage({ params: Promise.resolve({ locale: 'en', id: jobId }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('maps foreign ownership to notFound without exposing the source', async () => {
    io.job.mockRejectedValue(new NotFoundError())
    await expect(JobRecommendationsPage({ params: Promise.resolve({ locale: 'en', id: jobId }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('stops unverified or inactive employers before looking up a job', async () => {
    io.verified.mockRejectedValue(new ForbiddenError())
    await expect(JobRecommendationsPage({ params: Promise.resolve({ locale: 'en', id: jobId }) })).rejects.toThrow(ForbiddenError)
    expect(io.job).not.toHaveBeenCalled()
  })
  it('lists recommendation entry links only for current published jobs and disables prefetch', async () => {
    io.jobs.mockResolvedValue([{ id: jobId, title: 'Published', status: 'PUBLISHED', deadline: null },
      { id: 'draft', title: 'Draft', status: 'DRAFT', deadline: null },
      { id: 'expired', title: 'Expired', status: 'PUBLISHED', deadline: new Date('2000-01-01T00:00:00Z') }])
    const tree = nodes(await CompanyJobsPage({ params: Promise.resolve({ locale: 'en' }) }))
    const links = tree.filter(node => typeof node.props.href === 'string' && node.props.href.endsWith('/recommendations'))
    expect(links.map(node => node.props.href)).toEqual(['/e/jobs/' + jobId + '/recommendations'])
    expect(links[0].props.prefetch).toBe(false)
  })
})
