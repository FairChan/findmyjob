import { z } from 'zod'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { stateLabel } from '@/lib/my-states'
import { searchJobs } from '@/server/services/job-search'

const listParamsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(['INTERNSHIP', 'FULL_TIME', 'PART_TIME']).optional(),
  state: z.string().max(10).optional(),
  workMode: z.enum(['ONSITE', 'HYBRID', 'REMOTE']).optional(),
  sort: z.enum(['relevance', 'salary']).optional(),
  cursor: z.string().max(64).optional(),
})

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{
    q?: string
    type?: string
    state?: string
    workMode?: string
    sort?: string
    cursor?: string
  }>
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const raw = await searchParams
  const parsed = listParamsSchema.safeParse(raw)
  const { q, type, state, workMode } = parsed.success ? parsed.data : {}
  const hasFilters = !!(q || type || state || workMode)
  return {
    robots: hasFilters ? 'noindex,follow' : undefined,
  }
}

const PAGE_LIMIT = 20

export default async function JobsPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const raw = await searchParams
  const parsed = listParamsSchema.safeParse(raw)
  const { q, type, state, workMode, sort, cursor } = parsed.success ? parsed.data : {}
  const t = await getTranslations('publicJobs')

  const result = await searchJobs({
    q: q ?? '',
    filters: {
      ...(type ? { type } : {}),
      ...(state ? { state } : {}),
      ...(workMode ? { workMode } : {}),
      ...(sort ? { sort } : {}),
    },
    page: { cursor, limit: PAGE_LIMIT },
    // Public job list: description not searched (guests and non-quota users)
    canSeeDescription: false,
  })

  const items = [...result.exact, ...result.related]
  const { nextCursor } = result

  // Build URL for next page (preserve all current params + new cursor)
  function buildNextUrl(): string {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (type) p.set('type', type)
    if (state) p.set('state', state)
    if (workMode) p.set('workMode', workMode)
    if (sort) p.set('sort', sort)
    if (nextCursor) p.set('cursor', nextCursor)
    return `/${locale}/jobs?${p.toString()}`
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <>
          <ul className="space-y-4">
            {items.map((hit) => {
              const { job } = hit
              const companyName =
                locale === 'zh'
                  ? (job.company.displayNameZh ?? job.company.legalName)
                  : (job.company.displayNameEn ?? job.company.legalName)
              return (
                <li
                  key={job.id}
                  className="rounded-lg border bg-card p-4 hover:border-primary/50 transition-colors"
                >
                  <Link href={`/jobs/${job.id}`} prefetch={false} className="block">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="font-semibold text-foreground truncate">
                          {job.title}
                        </h2>
                        <p className="text-sm text-muted-foreground mt-0.5">{companyName}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5 flex-shrink-0">
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                          {t(`type.${job.type}`)}
                        </span>
                        {job.state && (
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                            {stateLabel(job.state, locale)}
                          </span>
                        )}
                      </div>
                    </div>
                    {(job.salaryMin != null || job.salaryMax != null) && (
                      <p className="mt-2 text-sm font-medium text-brand">
                        {job.salaryMin != null && job.salaryMax != null
                          ? `MYR ${job.salaryMin.toLocaleString()} – ${job.salaryMax.toLocaleString()}`
                          : job.salaryMin != null
                            ? `MYR ${job.salaryMin.toLocaleString()}+`
                            : `≤ MYR ${job.salaryMax!.toLocaleString()}`}
                      </p>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
          {nextCursor && (
            <div className="mt-8 text-center">
              <Link
                href={buildNextUrl()}
                className="inline-flex items-center rounded-md bg-muted px-4 py-2 text-sm font-medium hover:bg-muted/80 transition-colors"
                prefetch={false}
              >
                {t('loadMore')}
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}
