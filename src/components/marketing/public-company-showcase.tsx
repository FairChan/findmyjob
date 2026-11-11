import { getTranslations } from 'next-intl/server'
import { ArrowUpRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { getPublicCompanyShowcase } from '@/server/services/public-showcase'
import { getIndustryLabel } from '@/server/lib/taxonomy/industries'
import { CompanyMark, ShowcaseFrame, showcaseCardClass } from './showcase-frame'

export async function PublicCompanyShowcase({ locale }: { locale: string }) {
  const [t, data] = await Promise.all([getTranslations({ locale, namespace: 'publicShowcase' }), getPublicCompanyShowcase()])
  const copy = data.copy[locale === 'zh' ? 'zh' : 'en']
  const name = (company: typeof data.items[number]) => (locale === 'zh' ? company.displayNameZh : company.displayNameEn) || company.legalName
  return <ShowcaseFrame title={copy.title || t('companiesTitle')} description={copy.description || t('companiesDescription')}
    eyebrow={t('companiesEyebrow')} cta={t('companiesCta')} href={`/login?redirect=${encodeURIComponent(`/${locale}/s/companies`)}`}
    note={t('companiesNote')} collectionTitle={t('companiesCollection')}
    visual={<div className="grid w-full max-w-sm grid-cols-2 gap-3" aria-hidden="true">
      {data.items.slice(0, 4).map((company, index) => <div key={company.id} className={`flex min-w-0 flex-col items-center rounded-card border border-border bg-card px-3 py-6 text-center ${index % 2 ? 'translate-y-3' : ''}`}>
        <CompanyMark id={company.id} name={name(company)} hasLogo={!!company.logoKey} large />
        <p className="mt-4 line-clamp-2 w-full break-words text-sm font-semibold">{name(company)}</p>
      </div>)}
      {!data.items.length && <p className="col-span-2 rounded-card border border-border bg-card p-8 text-center text-muted-foreground">{t('companiesEmpty')}</p>}
    </div>}
  >
    {data.items.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.items.map(company => <Link key={company.id} href={`/companies/${company.id}`} prefetch={false} className={showcaseCardClass}>
      <div className="flex items-start justify-between gap-3"><CompanyMark id={company.id} name={name(company)} hasLogo={!!company.logoKey} /><ArrowUpRight className="size-5 shrink-0 text-muted-foreground group-hover:text-brand" aria-hidden="true" /></div>
      <h3 className="mt-5 break-words text-lg font-semibold">{name(company)}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{(company.industryCode && getIndustryLabel(company.industryCode, locale === 'zh' ? 'zh' : 'en')) || t('companyProfile')}</p>
      <p className="mt-4 text-sm text-muted-foreground">{[company.city, company.state].filter(Boolean).join(', ') || t('locationPending')}</p>
      <span className="mt-5 inline-block text-sm font-medium text-brand">{t('viewCompany')}</span>
    </Link>)}</div> : <p className="rounded-card border border-border p-8 text-muted-foreground">{t('companiesEmpty')}</p>}
  </ShowcaseFrame>
}
