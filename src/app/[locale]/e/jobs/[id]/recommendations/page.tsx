import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { requireVerifiedCompany } from '@/server/authz'
import { getCompanyJob } from '@/server/services/jobs'
import { NotFoundError } from '@/server/errors'
import { EmployerMatchingPanel } from '@/components/matching/EmployerMatchingPanel'
import { BACK_LINK_CLASS, WorkspacePage } from '@/components/layout/workspace-page'

export default async function JobRecommendationsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  const ctx = await requireVerifiedCompany('RECRUITER', await headers())
  let job: Awaited<ReturnType<typeof getCompanyJob>>
  try { job = await getCompanyJob(ctx, id) } catch (error) {
    if (error instanceof NotFoundError) return notFound()
    throw error
  }
  // eslint-disable-next-line react-hooks/purity -- Authenticated Server Component takes one request-time deadline snapshot; the action rechecks eligibility.
  const requestedAt = Date.now()
  if (job.status !== 'PUBLISHED' || job.deadline && job.deadline.getTime() <= requestedAt) return notFound()
  const t = await getTranslations('matching')
  return <WorkspacePage
    width="wide"
    title={t('employerTitle')}
    eyebrow={<Link href={'/' + locale + '/e/jobs'} prefetch={false} className={BACK_LINK_CLASS}>
      <ChevronLeft aria-hidden="true" className="size-4" />{t('backJobs')}
    </Link>}
  >
    <EmployerMatchingPanel key={job.id} locale={locale} job={{ id: job.id, title: job.title }} />
  </WorkspacePage>
}
