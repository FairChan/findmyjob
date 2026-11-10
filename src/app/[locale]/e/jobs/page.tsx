import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { requireCompanyMember } from '@/server/authz'
import { listCompanyJobs } from '@/server/services/jobs'
import { getCompanyEntitlementUsage } from '@/server/services/subscription-entitlements'
import { CompanyEntitlementSummary } from '@/components/billing/company-entitlement-summary'
import JobListClient from '@/components/jobs/job-list-client'
import type { JobStatus, JobType } from '@prisma/client'

export type JobListItem = {
  id: string
  title: string
  type: JobType
  category: string | null
  status: JobStatus
  state: string | null
  city: string | null
  workMode: string
  salaryMin: number | null
  salaryMax: number | null
  salaryVisible: boolean
  publishedAt: Date | null
  closedAt: Date | null
  deadline: Date | null
  createdAt: Date
  _count: { applications: number }
}

export default async function JobsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const h = await headers()
  const t = await getTranslations('jobs')
  const matching = await getTranslations('matching')

  const ctx = await requireCompanyMember('RECRUITER', h)
  const [jobs, usage] = await Promise.all([listCompanyJobs(ctx), getCompanyEntitlementUsage(ctx)])
  // eslint-disable-next-line react-hooks/purity -- Authenticated Server Component takes one request-time deadline snapshot; the action rechecks eligibility.
  const requestedAt = Date.now()
  const publishedJobs = jobs.filter(job => job.status === 'PUBLISHED' && (!job.deadline || job.deadline.getTime() > requestedAt))

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('listTitle')}</h1>
        <Link
          href="/e/jobs/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('newJob')}
        </Link>
      </div>

      <CompanyEntitlementSummary usage={usage} resource="jobs" />
      {publishedJobs.length > 0 && <section className="mb-6 space-y-2 rounded-lg border p-4" aria-labelledby="matching-jobs-title">
        <h2 id="matching-jobs-title" className="text-lg font-semibold">{matching('jobLinksTitle')}</h2>
        <p className="text-sm text-muted-foreground">{matching('jobLinksHint')}</p>
        <ul className="space-y-1">{publishedJobs.map(job => <li key={job.id}>
          <Link href={'/e/jobs/' + job.id + '/recommendations'} prefetch={false}
            className="inline-flex min-h-11 items-center text-sm text-primary underline [overflow-wrap:anywhere]">{job.title}</Link>
        </li>)}</ul>
      </section>}
      <JobListClient
        jobs={jobs as JobListItem[]}
        locale={locale}
        t={{
          emptyState: t('emptyState'),
          statusDraft: t('status.DRAFT'),
          statusPendingReview: t('status.PENDING_REVIEW'),
          statusPublished: t('status.PUBLISHED'),
          statusClosed: t('status.CLOSED'),
          statusRejected: t('status.REJECTED'),
          typeInternship: t('type.INTERNSHIP'),
          typeFullTime: t('type.FULL_TIME'),
          typePartTime: t('type.PART_TIME'),
          editButton: t('editButton'),
          copyButton: t('copyButton'),
          closeButton: t('closeButton'),
          confirmClose: t('confirmClose'),
          applications: t('applications'),
          copySuccess: t('copySuccess'),
          closeSuccess: t('closeSuccess'),
          errorUnknown: t('errorUnknown'),
          errorForbidden: t('errorForbidden'),
        }}
      />
    </div>
  )
}
