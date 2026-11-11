import { z } from 'zod'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { listPublicCompanies } from '@/server/services/company'
import { CompanyShowcase } from '@/components/company/company-showcase'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import type { CompanyTag } from '@prisma/client'

const COMPANY_TAGS: CompanyTag[] = [
  'FORTUNE_500', 'MULTINATIONAL', 'MY_LEADING', 'CN_OVERSEAS', 'SOE', 'ALUMNI', 'CHINESE_MY',
]

const pageParamsSchema = z.object({
  tag: z.enum(['FORTUNE_500', 'MULTINATIONAL', 'MY_LEADING', 'CN_OVERSEAS', 'SOE', 'ALUMNI', 'CHINESE_MY'] as const).optional(),
  cursor: z.string().max(64).optional(),
})

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tag?: string; cursor?: string }>
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const raw = await searchParams
  const parsed = pageParamsSchema.safeParse(raw)
  const hasFilters = !!(parsed.success && parsed.data.tag)
  const cursor = parsed.success ? parsed.data.cursor : undefined
  const t = await getTranslations({ locale, namespace: 'publicCompanies' })
  const baseUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  return {
    title: t('title'),
    description: t('description'),
    robots: hasFilters ? 'noindex,follow' : undefined,
    alternates: hasFilters ? undefined : {
      // A paginated page is its own canonical; pointing it at page 1 would drop it from the index.
      canonical: `${baseUrl}/${locale}/companies${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      languages: {
        'zh-Hans': `${baseUrl}/zh/companies`,
        'en': `${baseUrl}/en/companies`,
        'x-default': `${baseUrl}/zh/companies`,
      },
    },
  }
}

export default async function CompaniesPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const raw = await searchParams
  const parsed = pageParamsSchema.safeParse(raw)
  const { tag, cursor } = parsed.success ? parsed.data : {}

  const t = await getTranslations('publicCompanies')

  const { items: companies, nextCursor } = await listPublicCompanies({ tag, cursor })

  function buildUrl(params: { tag?: CompanyTag; cursor?: string }): string {
    const p = new URLSearchParams()
    if (params.tag) p.set('tag', params.tag)
    if (params.cursor) p.set('cursor', params.cursor)
    const qs = p.toString()
    return `/companies${qs ? `?${qs}` : ''}`
  }

  const tagClass = (selected: boolean) =>
    `inline-flex min-h-9 items-center rounded-full px-4 text-sm font-medium transition-colors ${
      selected ? 'bg-foreground text-background' : 'bg-muted text-foreground/80 hover:bg-border'
    }`

  return (
    <div className="page-shell pb-20 pt-10 md:pt-14">
      <PageHeader title={t('title')} lead={t('subtitle')} />

      {/* Showcase: needs a few companies to read as a row. */}
      {companies.length >= 3 && (
        <div className="mt-8">
          <CompanyShowcase
            companies={companies.map((company) => ({
              id: company.id,
              name: locale === 'zh' ? (company.displayNameZh ?? company.legalName) : (company.displayNameEn ?? company.legalName),
              logoSrc: company.logoKey ? `/api/logos/${company.id}` : null,
              description: company.description,
              jobCount: company.publishedJobCount,
            }))}
            labels={{
              region: t('showcase.region'),
              hint: t('showcase.hint'),
              jobs: t('showcase.jobs', { count: '{count}' }),
              noDescription: t('showcase.noDescription'),
              viewCompany: t('showcase.viewCompany'),
              close: t('showcase.close'),
            }}
          />
        </div>
      )}

      {/* Tag filters */}
      <div className="mt-8 flex flex-wrap gap-2">
        <Link href={buildUrl({})} aria-current={!tag ? 'true' : undefined} className={tagClass(!tag)} prefetch={false}>
          {t('tagAll')}
        </Link>
        {COMPANY_TAGS.map((ct) => (
          <Link
            key={ct}
            href={buildUrl({ tag: ct })}
            aria-current={tag === ct ? 'true' : undefined}
            className={tagClass(tag === ct)}
            prefetch={false}
          >
            {t(`tag${ct}` as Parameters<typeof t>[0])}
          </Link>
        ))}
      </div>

      {/* Company cards */}
      {companies.length === 0 ? (
        <EmptyState className="mt-8" title={t('empty')} />
      ) : (
        <>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {companies.map((company) => {
              const displayName =
                locale === 'zh'
                  ? (company.displayNameZh ?? company.legalName)
                  : (company.displayNameEn ?? company.legalName)
              const hasLogo = !!company.logoKey
              return (
                <Link
                  key={company.id}
                  href={`/companies/${company.id}`}
                  prefetch={false}
                  className="group flex flex-col items-center rounded-card bg-muted p-5 text-center transition-[background-color,box-shadow] hover:bg-card hover:shadow-float motion-reduce:transition-none"
                >
                  {hasLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/logos/${company.id}`}
                      alt={displayName}
                      className="size-14 rounded-control bg-card object-contain"
                    />
                  ) : (
                    <div className="flex size-14 items-center justify-center rounded-control bg-background text-xl font-semibold text-muted-foreground">
                      {displayName.charAt(0)}
                    </div>
                  )}
                  <p className="mt-4 line-clamp-2 text-sm font-semibold leading-snug">{displayName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {company.publishedJobCount}{t('openPositions')}
                  </p>
                </Link>
              )
            })}
          </div>
          {nextCursor && (
            <div className="mt-10 text-center">
              <Button asChild variant="secondary">
                <Link href={buildUrl({ tag, cursor: nextCursor })} prefetch={false}>
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
