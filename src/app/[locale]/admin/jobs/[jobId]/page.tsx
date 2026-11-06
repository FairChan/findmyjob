import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { requireAdmin } from '@/server/authz'
import { getJobForReview } from '@/server/services/review-jobs'
import { ReviewJobForm } from './ReviewJobForm'

export default async function AdminJobReviewPage({
  params,
}: {
  params: Promise<{ locale: string; jobId: string }>
}) {
  const { locale, jobId } = await params
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminJobs')

  const job = await getJobForReview(ctx, jobId)
  if (!job) return notFound()

  return (
    <main id="main-content" className="p-6 max-w-4xl mx-auto">
      <Link
        href={`/${locale}/admin/jobs`}
        className="text-sm text-muted-foreground hover:underline mb-4 inline-block"
      >
        ← {t('back')}
      </Link>

      <h1 className="text-2xl font-bold mb-6">{t('detailTitle')}</h1>

      <section className="rounded-lg border p-5 mb-6 space-y-2">
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('titleLabel')}</dt>
          <dd className="font-medium">{job.title}</dd>
          <dt className="text-muted-foreground">{t('companyLabel')}</dt>
          <dd>{job.company.legalName}</dd>
          <dt className="text-muted-foreground">{t('typeLabel')}</dt>
          <dd>{job.type}</dd>
        </dl>

        {job.description && (
          <div className="mt-3">
            <p className="text-sm font-medium mb-1">{t('descriptionLabel')}</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{job.description}</p>
          </div>
        )}
      </section>

      {job.status === 'PENDING_REVIEW' ? (
        <ReviewJobForm jobId={jobId} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('noJob')}</p>
      )}
    </main>
  )
}
