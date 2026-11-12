import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  instant: new Date('2026-11-04T17:02:03.000Z'),
  formatDate: vi.fn(),
  formatDateTime: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('Unexpected notFound') },
  redirect: () => { throw new Error('Unexpected redirect') },
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement('a', { href }, children),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
vi.mock('@/server/authz', () => ({
  requireAdmin: async () => ({ userId: 'admin-user' }),
}))
vi.mock('@/lib/format-date', () => ({
  formatKLDate: mocks.formatDate,
  formatKLDateTime: mocks.formatDateTime,
}))
vi.mock('@/components/admin/data-request-actions', () => ({ DataRequestActions: () => null }))
vi.mock('@/app/[locale]/admin/jobs/[jobId]/review-job-form', () => ({ ReviewJobForm: () => null }))
vi.mock('@/app/[locale]/admin/students/[studentId]/admin-student-actions', () => ({
  AdminStudentActions: () => null,
}))
vi.mock('@/server/services/data-rights', () => ({
  listDataRequestsForAdmin: async () => ({
    rows: [{
      id: 'request-id', type: 'EXPORT', status: 'DONE',
      createdAt: mocks.instant, user: { id: 'student-user' },
    }],
    hasMore: false,
    nextCursor: null,
  }),
}))
vi.mock('@/server/services/review-jobs', () => ({
  listPendingJobs: async () => [{
    id: 'job-id', title: 'Fictional job', type: 'INTERNSHIP',
    updatedAt: mocks.instant, company: { legalName: 'Fictional company' },
  }],
  getJobForReview: async () => ({
    id: 'job-id', title: 'Fictional job', type: 'INTERNSHIP', workMode: 'ONSITE',
    company: { legalName: 'Fictional company' }, deadline: mocks.instant,
    updatedAt: mocks.instant, status: 'PUBLISHED', languages: [], skills: [],
    salaryMin: null, salaryMax: null, headcount: null,
  }),
}))
vi.mock('@/server/services/admin-companies', () => ({
  searchCompanies: async () => ({
    items: [{
      id: 'company-id', legalName: 'Fictional company', verificationStatus: 'VERIFIED',
      isActive: true, isFoundingPartner: false, memberCount: 1, walletBalance: 0,
      createdAt: mocks.instant,
    }],
    total: 1,
  }),
}))
vi.mock('@/server/services/admin-users', () => ({
  searchStudentsSchema: { parse: () => ({ page: 1 }) },
  searchStudents: async () => ({
    items: [{
      userId: 'student-user', fullName: 'Fictional student', email: 'date@example.test',
      status: 'ACTIVE', schoolVerifiedAt: mocks.instant, completeness: 80,
    }],
    total: 1,
  }),
  getStudentAdminDetail: async () => ({
    userId: 'student-user', profileId: null, fullName: 'Fictional student',
    email: 'date@example.test', status: 'ACTIVE', emailVerified: true,
    schoolVerifiedAt: mocks.instant, completeness: 80, visibility: 'PUBLIC', skills: [],
  }),
}))
vi.mock('@/server/services/job-view-quota', () => ({ getQuota: async () => null }))
vi.mock('@/server/services/admin-audit', () => ({
  listAuditLogs: async () => ({
    items: [{
      id: 'audit-id', createdAt: mocks.instant, actorName: 'Fictional admin',
      actorEmail: null, actorRole: 'ADMIN', action: 'student.visibility.change',
      targetType: 'StudentProfile', targetId: 'student-id',
    }],
    nextCursor: null,
  }),
}))

import AdminDataRequestsPage from '@/app/[locale]/admin/data-requests/page'
import AdminCompaniesPage from '@/app/[locale]/admin/companies/page'
import AdminJobsPage from '@/app/[locale]/admin/jobs/page'
import AdminJobReviewPage from '@/app/[locale]/admin/jobs/[jobId]/page'
import AdminStudentsPage from '@/app/[locale]/admin/students/page'
import AdminStudentDetailPage from '@/app/[locale]/admin/students/[studentId]/page'
import AdminAuditPage from '@/app/[locale]/admin/audit/page'

const dateText = { zh: '2026年11月5日', en: '5 November 2026' } as const
const dateTimeText = { zh: '2026年11月5日 01:02:03', en: '5 November 2026, 01:02:03' } as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.formatDate.mockImplementation((_date: Date | string, locale: 'zh' | 'en') => dateText[locale])
  mocks.formatDateTime.mockImplementation((_date: Date | string, locale: 'zh' | 'en') => dateTimeText[locale])
})

const datePages: Array<{
  name: string
  render: (locale: string) => Promise<ReactNode>
}> = [
  {
    name: 'data requests',
    render: (locale) => AdminDataRequestsPage({
      params: Promise.resolve({ locale }), searchParams: Promise.resolve({}),
    }),
  },
  {
    name: 'companies',
    render: (locale) => AdminCompaniesPage({
      params: Promise.resolve({ locale }), searchParams: Promise.resolve({}),
    }),
  },
  {
    name: 'job review list',
    render: (locale) => AdminJobsPage({ params: Promise.resolve({ locale }) }),
  },
  {
    name: 'job review deadline',
    render: (locale) => AdminJobReviewPage({ params: Promise.resolve({ locale, jobId: 'job-id' }) }),
  },
  {
    name: 'students',
    render: (locale) => AdminStudentsPage({
      params: Promise.resolve({ locale }), searchParams: Promise.resolve({}),
    }),
  },
  {
    name: 'student school verification',
    render: (locale) => AdminStudentDetailPage({
      params: Promise.resolve({ locale, studentId: 'student-user' }),
    }),
  },
]

describe.each(['zh', 'en'] as const)('M4-T17: %s admin dates use the shared formatter', (locale) => {
  it.each(datePages)('$name preserves the timestamp and current UI locale', async ({ render }) => {
    const html = renderToStaticMarkup(await render(locale))

    expect(mocks.formatDate).toHaveBeenCalled()
    const [value, suppliedLocale] = mocks.formatDate.mock.calls[0]
    expect(new Date(value).toISOString()).toBe(mocks.instant.toISOString())
    expect(suppliedLocale).toBe(locale)
    expect(html).toContain(dateText[locale])
  })

  it('audit rows use the shared timestamp formatter without losing seconds', async () => {
    const html = renderToStaticMarkup(await AdminAuditPage({
      params: Promise.resolve({ locale }), searchParams: Promise.resolve({}),
    }))

    expect(mocks.formatDateTime).toHaveBeenCalled()
    const [value, suppliedLocale] = mocks.formatDateTime.mock.calls[0]
    expect(new Date(value).toISOString()).toBe(mocks.instant.toISOString())
    expect(suppliedLocale).toBe(locale)
    expect(html).toContain(dateTimeText[locale])
  })
})
