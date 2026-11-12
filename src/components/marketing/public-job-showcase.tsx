import { getTranslations } from 'next-intl/server'
import { ArrowUpRight, MapPin } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { getPublicJobShowcase } from '@/server/services/public-showcase'
import { CompanyMark, ShowcaseFrame, showcaseCardClass } from './showcase-frame'

export async function PublicJobShowcase({ locale }: { locale: string }) {
  const [t, data] = await Promise.all([getTranslations({ locale, namespace: 'publicShowcase' }), getPublicJobShowcase()])
  const copy = data.copy[locale === 'zh' ? 'zh' : 'en']
  const name = (company: typeof data.items[number]['company']) => (locale === 'zh' ? company.displayNameZh : company.displayNameEn) || company.legalName
  return <ShowcaseFrame
    title={copy.title || t('jobsTitle')} description={copy.description || t('jobsDescription')}
    eyebrow={t('jobsEyebrow')} cta={t('jobsCta')} href={`/login?redirect=${encodeURIComponent(`/${locale}/s/jobs`)}`}
    note={t('jobsNote')} collectionTitle={t('jobsCollection')}
    visual={<div className="w-full max-w-sm space-y-3" aria-hidden="true">
      {data.items.slice(0, 3).map((job, index) => <div key={job.id} className={`flex min-w-0 items-center gap-4 rounded-card border border-border bg-card p-5 ${index === 1 ? 'sm:ml-8' : 'sm:mr-8'}`}>
        <CompanyMark id={job.company.id} name={name(job.company)} hasLogo={!!job.company.logoKey} />
        <div className="min-w-0"><p className="text-xs font-semibold text-brand">{t(`type${job.type}`)}</p><p className="mt-1 truncate font-semibold">{job.title}</p><p className="truncate text-sm text-muted-foreground">{name(job.company)}</p></div>
      </div>)}
      {!data.items.length && <p className="rounded-card border border-border bg-card p-8 text-center text-muted-foreground">{t('jobsEmpty')}</p>}
    </div>}
  >
    {data.items.length ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{data.items.map(job => <Link key={job.id} href={`/jobs/${job.id}`} prefetch={false} className={showcaseCardClass}>
      <div className="flex items-start justify-between gap-3"><CompanyMark id={job.company.id} name={name(job.company)} hasLogo={!!job.company.logoKey} /><ArrowUpRight className="size-5 shrink-0 text-muted-foreground group-hover:text-brand" aria-hidden="true" /></div>
      <p className="mt-5 text-sm font-medium text-brand">{t(`type${job.type}`)}</p>
      <h3 className="mt-2 break-words text-lg font-semibold">{job.title}</h3>
      <p className="mt-2 break-words text-sm text-muted-foreground">{name(job.company)}</p>
      <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="size-4 shrink-0" aria-hidden="true" />{[job.city, job.state].filter(Boolean).join(', ') || t('locationPending')}</p>
      <p className="mt-2 text-xs text-muted-foreground">{t(`mode${job.workMode}`)}</p>
    </Link>)}</div> : <p className="rounded-card border border-border p-8 text-muted-foreground">{t('jobsEmpty')}</p>}
  </ShowcaseFrame>
}
