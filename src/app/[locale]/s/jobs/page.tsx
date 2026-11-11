import { z } from 'zod'
import { headers } from 'next/headers'
import { requireStudent } from '@/server/authz'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { MY_STATES, stateLabel } from '@/lib/my-states'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FIELD_CLASS } from '@/components/ui/field'
import { PageHeader } from '@/components/ui/page-header'
import { TextLink } from '@/components/ui/text-link'
import { BrandLine } from '@/components/layout/brand-line'
import { JobCard } from '@/components/jobs/job-card'
import { searchJobs } from '@/server/services/job-search'
import type { CompanyTag, CompanySize } from '@prisma/client'

const VALID_COMPANY_TAGS: CompanyTag[] = [
  'FORTUNE_500', 'MULTINATIONAL', 'MY_LEADING', 'CN_OVERSEAS', 'SOE', 'ALUMNI', 'CHINESE_MY',
]

const JOB_TYPES = ['INTERNSHIP', 'FULL_TIME', 'PART_TIME'] as const
const WORK_MODES = ['ONSITE', 'HYBRID', 'REMOTE'] as const

const listParamsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(JOB_TYPES).optional(),
  state: z.string().max(10).optional(),
  workMode: z.enum(WORK_MODES).optional(),
  sort: z.enum(['relevance', 'salary']).optional(),
  cursor: z.string().max(64).optional(),
  // Extended filters (M5-T10)
  industry: z.string().max(50).optional(),
  /** Comma-separated CompanyTag values */
  tags: z.string().max(200).optional(),
  size: z.enum(['S1_10', 'S11_50', 'S51_200', 'S201_1000', 'S1000_PLUS']).optional(),
  salary: z.coerce.number().int().min(1).max(1_000_000).optional(),
})

// The filter form submits every control, so an unused one arrives as an empty string.
// One invalid value makes the whole parse fail and drops every filter, so blanks go first.
function withoutBlanks(raw: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''))
}

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
  const parsed = listParamsSchema.safeParse(withoutBlanks(raw))
  const { q, type, state, workMode, industry, tags: rawTags, size, salary, cursor } = parsed.success ? parsed.data : {}
  const hasFilters = !!(q || type || state || workMode || industry || rawTags || size || salary)
  const t = await getTranslations({ locale, namespace: 'publicJobs' })
  const baseUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  return {
    title: t('title'),
    description: t('description'),
    robots: 'noindex,nofollow',
    alternates: hasFilters ? undefined : {
      // A paginated page is its own canonical; pointing it at page 1 would drop it from the index.
      canonical: `${baseUrl}/${locale}/s/jobs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      languages: {
        'zh-Hans': `${baseUrl}/zh/s/jobs`,
        'en': `${baseUrl}/en/s/jobs`,
        'x-default': `${baseUrl}/zh/s/jobs`,
      },
    },
  }
}

const PAGE_LIMIT = 20

export default async function JobsPage({ params, searchParams }: PageProps) {
  await requireStudent(await headers())
  const { locale } = await params
  const raw = await searchParams
  const parsed = listParamsSchema.safeParse(withoutBlanks(raw))
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
    return `/s/jobs?${p.toString()}`
  }

  const hasFilters = !!(q || type || state || workMode || industry || rawTags || size || salary)

  return (
    <div className="page-shell max-w-7xl pb-20 pt-10 md:pt-14">
      <PageHeader eyebrow={<BrandLine word="right" />} title={t('title')} lead={t('description')} />

      <form
        action={`/${locale}/s/jobs`}
        method="get"
        role="search"
        aria-label={t('filters.label')}
        className="mt-8 grid gap-3 rounded-card bg-muted p-4 sm:grid-cols-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]"
      >
        {/* Filters that have no control here still survive a new search. */}
        {sort && <input type="hidden" name="sort" value={sort} />}
        {industry && <input type="hidden" name="industry" value={industry} />}
        {rawTags && <input type="hidden" name="tags" value={rawTags} />}
        {size && <input type="hidden" name="size" value={size} />}
        {salary && <input type="hidden" name="salary" value={salary} />}
        <div className="sm:col-span-3 lg:col-span-1">
          <label htmlFor="jobs-q" className="sr-only">
            {t('filters.keyword')}
          </label>
          <input
            id="jobs-q"
            type="search"
            name="q"
            defaultValue={q ?? ''}
            maxLength={100}
            placeholder={t('filters.keywordPlaceholder')}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label htmlFor="jobs-type" className="sr-only">
            {t('filters.type')}
          </label>
          <select id="jobs-type" key={type ?? 'all'} name="type" defaultValue={type ?? ''} className={FIELD_CLASS}>
            <option value="">{t('filters.allTypes')}</option>
            {JOB_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`type.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="jobs-work-mode" className="sr-only">
            {t('filters.workMode')}
          </label>
          <select
            id="jobs-work-mode"
            key={workMode ?? 'all'}
            name="workMode"
            defaultValue={workMode ?? ''}
            className={FIELD_CLASS}
          >
            <option value="">{t('filters.allWorkModes')}</option>
            {WORK_MODES.map((value) => (
              <option key={value} value={value}>
                {t(`workMode.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="jobs-state" className="sr-only">
            {t('filters.state')}
          </label>
          <select id="jobs-state" key={state ?? 'all'} name="state" defaultValue={state ?? ''} className={FIELD_CLASS}>
            <option value="">{t('filters.allStates')}</option>
            {MY_STATES.map((item) => (
              <option key={item.code} value={item.code}>
                {locale === 'zh' ? item.labelZh : item.labelEn}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1 sm:col-span-3 lg:col-span-1">
          <Button type="submit" variant="brand" className="h-11 flex-1 px-6 lg:flex-none">
            {t('filters.submit')}
          </Button>
          {hasFilters && (
            <Link
              href="/s/jobs"
              prefetch={false}
              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 text-sm text-brand underline-offset-4 hover:underline"
            >
              {t('filters.reset')}
            </Link>
          )}
        </div>
      </form>

      {items.length === 0 ? (
        <EmptyState
          className="mt-8"
          title={t('empty')}
          description={hasFilters ? t('filters.emptyHint') : undefined}
          action={
            hasFilters ? (
              <TextLink href="/s/jobs" prefetch={false} chevron={false}>
                {t('filters.reset')}
              </TextLink>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((hit) => {
              const { job } = hit
              const companyName =
                locale === 'zh'
                  ? (job.company.displayNameZh ?? job.company.legalName)
                  : (job.company.displayNameEn ?? job.company.legalName)
              const jobState = stateLabel(job.state, locale)
              const jobSalary =
                job.salaryMin != null && job.salaryMax != null
                  ? `MYR ${job.salaryMin.toLocaleString()} – ${job.salaryMax.toLocaleString()}`
                  : job.salaryMin != null
                    ? `MYR ${job.salaryMin.toLocaleString()}+`
                    : job.salaryMax != null
                      ? `≤ MYR ${job.salaryMax.toLocaleString()}`
                      : null
              return (
                <li key={job.id}>
                  <JobCard
                    layout="tile"
                    as="h2"
                    jobId={job.id}
                    href={`/s/jobs/${job.id}`}
                    title={job.title}
                    company={companyName}
                    salary={jobSalary}
                    badges={[
                      { label: t(`type.${job.type}`) },
                      { label: t(`workMode.${job.workMode}`) },
                      ...(jobState ? [{ label: jobState }] : []),
                      ...(job.acceptsStudentPass
                        ? [{ label: t('facts.studentPass'), tone: 'success' as const }]
                        : []),
                    ]}
                  />
                </li>
              )
            })}
          </ul>
          {nextCursor && (
            <div className="mt-10 text-center">
              <Button asChild variant="secondary">
                <Link href={buildNextUrl()} prefetch={false}>
                  {t('loadMore')}
                </Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
