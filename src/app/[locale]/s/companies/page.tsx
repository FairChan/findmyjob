import { z } from 'zod'
import { headers } from 'next/headers'
import { requireStudent } from '@/server/authz'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getPublicCompany, listPublicCompanies } from '@/server/services/company'
import { listCompanyBrowseJobs } from '@/server/services/company-browse'
import { CompanyBrowser } from '@/components/company/company-browser'
import { CompanyJobsPanel } from '@/components/company/company-jobs-panel'
import { stateLabel } from '@/lib/my-states'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import type { CompanyTag } from '@prisma/client'

const COMPANY_TAGS = [
  'FORTUNE_500', 'MULTINATIONAL', 'MY_LEADING', 'CN_OVERSEAS', 'SOE', 'ALUMNI', 'CHINESE_MY',
] as const satisfies readonly CompanyTag[]

const tagSchema = z.enum(COMPANY_TAGS)
const cursorSchema = z.string().cuid()

interface BrowseParams { tag?: CompanyTag; cursor?: string; company?: string; jobsCursor?: string }
interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tag?: string; cursor?: string; company?: string; jobsCursor?: string }>
}

function buildUrl(params: BrowseParams): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  return `/s/companies${query.size ? `?${query}` : ''}`
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const raw = await searchParams
  const tag = tagSchema.safeParse(raw.tag).data
  const cursor = cursorSchema.safeParse(raw.cursor).data
  const t = await getTranslations({ locale, namespace: 'publicCompanies' })
  const baseUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  return {
    title: t('title'),
    description: t('description'),
    robots: 'noindex,nofollow',
    alternates: tag ? undefined : {
      canonical: `${baseUrl}/${locale}/s/companies${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      languages: {
        'zh-Hans': `${baseUrl}/zh/s/companies`,
        'en': `${baseUrl}/en/s/companies`,
        'x-default': `${baseUrl}/zh/s/companies`,
      },
    },
  }
}

export default async function CompaniesPage({ params, searchParams }: PageProps) {
  await requireStudent(await headers())
  const { locale } = await params
  const raw = await searchParams
  // Parse independently so an invalid external selection never discards valid list filters.
  const tag = tagSchema.safeParse(raw.tag).data
  const cursor = cursorSchema.safeParse(raw.cursor).data
  const jobsCursor = cursorSchema.safeParse(raw.jobsCursor).data
  const requestedCompany = cursorSchema.safeParse(raw.company).data
  const t = await getTranslations('publicCompanies')
  const browser = await getTranslations('companyBrowser')
  const { items: companies, nextCursor } = await listPublicCompanies({ tag, cursor })
  const selection = raw.company !== undefined ? requestedCompany : companies[0]?.id
  const selectedCompany = selection ? await getPublicCompany(selection) : null
  const selectedName = selectedCompany
    ? locale === 'zh' ? selectedCompany.displayNameZh ?? selectedCompany.legalName : selectedCompany.displayNameEn ?? selectedCompany.legalName
    : null
  const jobs = selectedCompany ? await listCompanyBrowseJobs(selectedCompany.id, jobsCursor) : { items: [], nextCursor: null }
  const tagClass = (selected: boolean) =>
    `inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selected ? 'bg-foreground text-background' : 'bg-muted text-foreground/80 hover:bg-border'}`

  return (
    <div className="page-shell max-w-7xl pb-20 pt-10 md:pt-14">
      <PageHeader title={t('title')} lead={t('subtitle')} />
      <nav aria-label={browser('filters')} className="mt-8 flex flex-wrap gap-2">
        <Link href={buildUrl({})} aria-current={!tag ? 'true' : undefined} className={tagClass(!tag)} prefetch={false}>{t('tagAll')}</Link>
        {COMPANY_TAGS.map(value => <Link key={value} href={buildUrl({ tag: value })} aria-current={tag === value ? 'true' : undefined} className={tagClass(tag === value)} prefetch={false}>{t(`tag${value}`)}</Link>)}
      </nav>
      <CompanyBrowser
        companies={companies.map(company => ({
          id: company.id,
          name: locale === 'zh' ? company.displayNameZh ?? company.legalName : company.displayNameEn ?? company.legalName,
          hasLogo: !!company.logoKey,
          location: [company.city, stateLabel(company.state, locale)].filter(Boolean).join(', '),
          jobCount: browser('jobCount', { count: company.publishedJobCount }),
          href: buildUrl({ tag, cursor, company: company.id }),
        }))}
        selectedId={selectedCompany?.id ?? null}
        selectedName={selectedName}
        labels={{ selected: browser('selected'), loading: browser('loading'), selectedFeedback: browser('selectedFeedback', { name: '{name}' }) }}
        empty={<EmptyState title={t('empty')} />}
        pagination={(cursor || nextCursor) && <nav aria-label={browser('companyPagination')} className="mt-8 flex flex-wrap justify-center gap-3">
          {cursor && <Button asChild variant="secondary"><Link href={buildUrl({ tag })} prefetch={false}>{browser('firstCompanies')}</Link></Button>}
          {nextCursor && <Button asChild variant="secondary"><Link href={buildUrl({ tag, cursor: nextCursor })} prefetch={false}>{browser('nextCompanies')}</Link></Button>}
        </nav>}
        panel={<CompanyJobsPanel
          company={selectedCompany} locale={locale} jobs={jobs.items} missing={raw.company !== undefined}
          firstHref={selectedCompany && jobsCursor ? buildUrl({ tag, cursor, company: selectedCompany.id }) : null}
          nextHref={selectedCompany && jobs.nextCursor ? buildUrl({ tag, cursor, company: selectedCompany.id, jobsCursor: jobs.nextCursor }) : null}
        />}
      />
    </div>
  )
}
