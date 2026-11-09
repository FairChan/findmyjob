import { z } from 'zod'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { listPublicCompanies } from '@/server/services/company'
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
    return `/${locale}/companies${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Tag filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={buildUrl({})}
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium border transition-colors ${
            !tag
              ? 'bg-brand text-brand-foreground border-brand'
              : 'bg-background text-muted-foreground border-border hover:bg-muted'
          }`}
          prefetch={false}
        >
          {t('tagAll')}
        </Link>
        {COMPANY_TAGS.map((ct) => (
          <Link
            key={ct}
            href={buildUrl({ tag: ct })}
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium border transition-colors ${
              tag === ct
                ? 'bg-brand text-brand-foreground border-brand'
                : 'bg-background text-muted-foreground border-border hover:bg-muted'
            }`}
            prefetch={false}
          >
            {t(`tag${ct}` as Parameters<typeof t>[0])}
          </Link>
        ))}
      </div>

      {/* Company cards */}
      {companies.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
                  className="group flex flex-col items-center rounded-lg border bg-card p-4 text-center hover:border-primary/50 transition-colors"
                >
                  {hasLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/logos/${company.id}`}
                      alt={displayName}
                      className="h-14 w-14 rounded-md object-contain border bg-white"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-md border bg-muted text-xl font-bold text-muted-foreground">
                      {displayName.charAt(0)}
                    </div>
                  )}
                  <p className="mt-3 line-clamp-2 text-sm font-medium leading-snug">{displayName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {company.publishedJobCount}{t('openPositions')}
                  </p>
                </Link>
              )
            })}
          </div>
          {nextCursor && (
            <div className="mt-8 text-center">
              <Link
                href={buildUrl({ tag, cursor: nextCursor })}
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
