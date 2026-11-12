import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getPublicCompany } from '@/server/services/company'
import { safeWebsiteHref } from '@/lib/url-utils'
import { ArrowUpRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { TextLink } from '@/components/ui/text-link'
import { db } from '@/server/db'
import { JobCard } from '@/components/jobs/job-card'

const companyIdSchema = z.string().cuid()

interface PageProps {
  params: Promise<{ locale: string; id: string }>
  member?: boolean
  searchParams?: Promise<{ cursor?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, id } = await params
  if (!companyIdSchema.safeParse(id).success) return {}
  const company = await getPublicCompany(id)
  if (!company) return {}
  const t = await getTranslations({ locale, namespace: 'companyProfile' })
  const displayName =
    locale === 'zh'
      ? (company.displayNameZh ?? company.legalName)
      : (company.displayNameEn ?? company.legalName)
  const baseUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  return {
    title: displayName,
    description: t('metaDescription', { name: displayName }),
    alternates: {
      canonical: `${baseUrl}/${locale}/companies/${id}`,
      languages: {
        'zh-Hans': `${baseUrl}/zh/companies/${id}`,
        'en': `${baseUrl}/en/companies/${id}`,
        'x-default': `${baseUrl}/zh/companies/${id}`,
      },
    },
  }
}

export default async function CompanyPublicPage({ params, member = false, searchParams }: PageProps) {
  const { locale, id } = await params
  const t = await getTranslations('companyProfile')

  if (!companyIdSchema.safeParse(id).success) return notFound()

  const company = await getPublicCompany(id)
  if (!company) return notFound()
  const rawCursor = (await searchParams)?.cursor
  const cursor = z.string().cuid().safeParse(rawCursor)
  const jobs = member ? await db.job.findMany({
    where: { companyId: id, status: 'PUBLISHED', OR: [{ deadline: null }, { deadline: { gt: new Date() } }], ...(cursor.success ? { id: { gt: cursor.data } } : {}) },
    select: { id: true, title: true, type: true, state: true, salaryMin: true, salaryMax: true, salaryVisible: true },
    orderBy: { id: 'asc' }, take: 21,
  }) : []
  const jobLabels = await getTranslations('publicJobs')
  const showcase = await getTranslations('publicShowcase')
  // Write-time validation already requires http(s); this also covers older or imported rows.
  const websiteHref = safeWebsiteHref(company.website)

  const displayName =
    locale === 'zh'
      ? (company.displayNameZh ?? company.legalName)
      : (company.displayNameEn ?? company.legalName)

  const hasLogo = !!company.logoKey

  const locationParts = [company.city, company.state].filter(Boolean)

  return (
    <div className="page-shell max-w-3xl pb-20 pt-10 md:pt-14">
      {/* Company header */}
      <header className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/logos/${company.id}`}
            alt={displayName}
            className="size-20 shrink-0 rounded-card border bg-card object-contain"
          />
        ) : (
          <div className="flex size-20 shrink-0 items-center justify-center rounded-card bg-muted text-2xl font-semibold text-muted-foreground">
            {displayName.charAt(0)}
          </div>
        )}

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="break-words text-headline">{displayName}</h1>
            {company.isFoundingPartner && <Badge tone="warning">{t('foundingPartner')}</Badge>}
          </div>

          {displayName !== company.legalName && (
            <p className="mt-1 text-sm text-muted-foreground">{company.legalName}</p>
          )}
        </div>
      </header>

      {(locationParts.length > 0 || websiteHref) && (
        <dl className="mt-8 grid grid-cols-2 gap-x-8 border-y">
          {locationParts.length > 0 && (
            <div className="py-4">
              <dt className="text-xs text-muted-foreground">{t('location')}</dt>
              <dd className="mt-1 text-body font-medium">{locationParts.join(', ')}</dd>
            </div>
          )}
          {websiteHref && (
            <div className="py-4">
              <dt className="text-xs text-muted-foreground">{t('website')}</dt>
              <dd className="mt-1 min-w-0 text-body font-medium">
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-6 max-w-full items-center gap-1 text-brand underline-offset-4 hover:underline"
                >
                  <span className="truncate">{new URL(websiteHref).hostname}</span>
                  <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* Description */}
      {company.description && (
        <section className="mt-10">
          <p className="whitespace-pre-wrap text-body">{company.description}</p>
        </section>
      )}

      {/* Open positions */}
      <section className="mt-12">
        <h2 className="text-title">{t('openPositions')}</h2>
        {member && jobs.length > 0 ? <>
          <ul className="mt-4 grid gap-3">
            {jobs.slice(0, 20).map(job => <li key={job.id}><JobCard jobId={job.id} href={`/s/jobs/${job.id}`} title={job.title} company={displayName} layout="row" as="h3"
              badges={[{ label: jobLabels(`type.${job.type}`) }, ...(job.state ? [{ label: job.state }] : [])]}
              salary={job.salaryVisible && (job.salaryMin !== null || job.salaryMax !== null) ? `MYR ${job.salaryMin ?? '—'} – ${job.salaryMax ?? '—'}` : null} /></li>)}
          </ul>
          {jobs.length > 20 && <TextLink href={`/s/companies/${id}?cursor=${jobs[19].id}`} prefetch={false}>{jobLabels('loadMore')}</TextLink>}
        </> : member ? <EmptyState
          className="mt-4"
          title={<span className="text-body font-medium">{t('noJobs')}</span>}
          action={
            <TextLink href="/s/jobs" prefetch={false}>
              {t('browseJobs')}
            </TextLink>
          }
        /> : <div className="mt-4 rounded-card bg-muted p-6"><TextLink href={`/login?redirect=/${locale}/s/companies/${id}`} prefetch={false}>{showcase('jobsCta')}</TextLink></div>}
      </section>
    </div>
  )
}
