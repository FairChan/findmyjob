import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireVerifiedCompany } from '@/server/authz'
import { getCompanyJob } from '@/server/services/jobs'
import { NotFoundError } from '@/server/errors'
import { EmployerMatchingPanel } from '@/components/matching/EmployerMatchingPanel'

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
  return <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
    <h1 className="text-2xl font-bold">{t('employerTitle')}</h1>
    <Link href={'/' + locale + '/e/jobs'} prefetch={false} className="inline-flex min-h-11 items-center text-sm text-primary underline">{t('backJobs')}</Link>
    <EmployerMatchingPanel key={job.id} locale={locale} job={{ id: job.id, title: job.title }} />
  </div>
}
