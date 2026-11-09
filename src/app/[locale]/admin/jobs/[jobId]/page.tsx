import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { headers } from 'next/headers'
import { requireAdmin } from '@/server/authz'
import { getJobForReview } from '@/server/services/review-jobs'
import { ReviewJobForm } from './review-job-form'
import { formatKLDate } from '@/lib/format-date'

export default async function AdminJobReviewPage({
  params,
}: {
  params: Promise<{ locale: string; jobId: string }>
}) {
  const { locale, jobId } = await params
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminJobs')
  const tJobs = await getTranslations('jobs')

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

      <section className="rounded-lg border p-5 mb-6 space-y-3">
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('titleLabel')}</dt>
          <dd className="font-medium">{job.title}</dd>

          <dt className="text-muted-foreground">{t('companyLabel')}</dt>
          <dd>{job.company.legalName}</dd>

          <dt className="text-muted-foreground">{t('typeLabel')}</dt>
          <dd>{tJobs(`type.${job.type}`)}</dd>

          <dt className="text-muted-foreground">{t('workModeLabel')}</dt>
          <dd>{tJobs(`workMode.${job.workMode}`)}</dd>

          {job.category && (
            <>
              <dt className="text-muted-foreground">{t('categoryLabel')}</dt>
              <dd className="break-words">{job.category}</dd>
            </>
          )}

          {(job.state || job.city) && (
            <>
              <dt className="text-muted-foreground">{t('locationLabel')}</dt>
              <dd>{[job.state, job.city].filter(Boolean).join(' · ')}</dd>
            </>
          )}

          {(job.salaryMin != null || job.salaryMax != null) && (
            <>
              <dt className="text-muted-foreground">{t('salaryLabel')}</dt>
              <dd>
                {job.salaryMin ?? '—'} – {job.salaryMax ?? '—'} MYR
                {!job.salaryVisible && (
                  <span className="ml-2 text-xs text-muted-foreground">({t('salaryHiddenNote')})</span>
                )}
              </dd>
            </>
          )}

          {job.headcount != null && (
            <>
              <dt className="text-muted-foreground">{t('headcountLabel')}</dt>
              <dd>{job.headcount}</dd>
            </>
          )}

          {job.deadline && (
            <>
              <dt className="text-muted-foreground">{t('deadlineLabel')}</dt>
              <dd>{formatKLDate(job.deadline, locale)}</dd>
            </>
          )}

          <dt className="text-muted-foreground">{t('acceptsStudentPassLabel')}</dt>
          <dd>{job.acceptsStudentPass ? t('yes') : t('no')}</dd>

          <dt className="text-muted-foreground">{t('sponsorsWorkPassLabel')}</dt>
          <dd>{job.sponsorsWorkPass ? t('yes') : t('no')}</dd>

          {job.languages.length > 0 && (
            <>
              <dt className="text-muted-foreground">{t('languagesLabel')}</dt>
              <dd>{job.languages.join(', ')}</dd>
            </>
          )}

          {job.skills.length > 0 && (
            <>
              <dt className="text-muted-foreground">{t('skillsLabel')}</dt>
              <dd className="break-words">{job.skills.join(', ')}</dd>
            </>
          )}
        </dl>

        {job.description && (
          <div className="pt-2">
            <p className="text-sm font-medium mb-1">{t('descriptionLabel')}</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{job.description}</p>
          </div>
        )}

        {job.requirements && (
          <div className="pt-2">
            <p className="text-sm font-medium mb-1">{t('requirementsLabel')}</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{job.requirements}</p>
          </div>
        )}

        {job.benefits && (
          <div className="pt-2">
            <p className="text-sm font-medium mb-1">{t('benefitsLabel')}</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{job.benefits}</p>
          </div>
        )}
      </section>

      {job.status === 'PENDING_REVIEW' ? (
        <ReviewJobForm jobId={jobId} updatedAt={job.updatedAt.toISOString()} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('noJob')}</p>
      )}
    </main>
  )
}
