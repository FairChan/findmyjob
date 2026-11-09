import { z } from 'zod'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { stateLabel } from '@/lib/my-states'
import { searchJobs } from '@/server/services/job-search'
import type { CompanyTag, CompanySize } from '@prisma/client'

const VALID_COMPANY_TAGS: CompanyTag[] = [
  'FORTUNE_500', 'MULTINATIONAL', 'MY_LEADING', 'CN_OVERSEAS', 'SOE', 'ALUMNI', 'CHINESE_MY',
]

const listParamsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(['INTERNSHIP', 'FULL_TIME', 'PART_TIME']).optional(),
  state: z.string().max(10).optional(),
  workMode: z.enum(['ONSITE', 'HYBRID', 'REMOTE']).optional(),
  sort: z.enum(['relevance', 'salary']).optional(),
  cursor: z.string().max(64).optional(),
  // Extended filters (M5-T10)
  industry: z.string().max(50).optional(),
  /** Comma-separated CompanyTag values */
  tags: z.string().max(200).optional(),
  size: z.enum(['S1_10', 'S11_50', 'S51_200', 'S201_1000', 'S1000_PLUS']).optional(),
  salary: z.coerce.number().int().min(1).max(1_000_000).optional(),
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
    industry?: string
    tags?: string
    size?: string
    salary?: string
  }>
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const raw = await searchParams
  const parsed = listParamsSchema.safeParse(raw)
  const { q, type, state, workMode, industry, tags: rawTags, size, salary, cursor } = parsed.success ? parsed.data : {}
  const hasFilters = !!(q || type || state || workMode || industry || rawTags || size || salary)
  const t = await getTranslations({ locale, namespace: 'publicJobs' })
  const baseUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  return {
    title: t('title'),
    description: t('description'),
    robots: hasFilters ? 'noindex,follow' : undefined,
    alternates: hasFilters ? undefined : {
      // A paginated page is its own canonical; pointing it at page 1 would drop it from the index.
      canonical: `${baseUrl}/${locale}/jobs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      languages: {
        'zh-Hans': `${baseUrl}/zh/jobs`,
        'en': `${baseUrl}/en/jobs`,
        'x-default': `${baseUrl}/zh/jobs`,
      },
    },
  }
}

const PAGE_LIMIT = 20

export default async function JobsPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const raw = await searchParams
  const parsed = listParamsSchema.safeParse(raw)
  const { q, type, state, workMode, sort, cursor, industry, tags: rawTags, size, salary } =
    parsed.success ? parsed.data : {}

  // Parse and validate tags (comma-separated CompanyTag values from URL)
  const tags =
    rawTags
      ? (rawTags.split(',').filter((t): t is CompanyTag => (VALID_COMPANY_TAGS as string[]).includes(t)) as CompanyTag[])
      : undefined

  const t = await getTranslations('publicJobs')

  const result = await searchJobs({
    q: q ?? '',
    filters: {
      ...(type ? { type } : {}),
      ...(state ? { state } : {}),
      ...(workMode ? { workMode } : {}),
      ...(sort ? { sort } : {}),
      ...(industry ? { industry } : {}),
      ...(tags?.length ? { tags } : {}),
      ...(size ? { size: size as CompanySize } : {}),
      ...(salary ? { salaryAtLeast: salary } : {}),
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
    if (industry) p.set('industry', industry)
    if (rawTags) p.set('tags', rawTags)
    if (size) p.set('size', size)
    if (salary) p.set('salary', String(salary))
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
