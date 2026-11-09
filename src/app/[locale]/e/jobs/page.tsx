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

  const ctx = await requireCompanyMember('RECRUITER', h)
  const [jobs, usage] = await Promise.all([listCompanyJobs(ctx), getCompanyEntitlementUsage(ctx)])

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
