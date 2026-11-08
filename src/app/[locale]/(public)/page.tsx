import type { Metadata } from 'next'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getHomePartners } from '@/server/services/admin-schools-partners'
import { getHomeStats, getLatestJobs } from '@/server/services/home'
import { safeWebsiteHref } from '@/lib/url-utils'

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'home' })
  const baseUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: `${baseUrl}/${locale}`,
      languages: {
        'zh-Hans': `${baseUrl}/zh`,
        'en': `${baseUrl}/en`,
        'x-default': `${baseUrl}/zh`,
      },
    },
  }
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'home' })
  const nt = await getTranslations({ locale, namespace: 'nav' })

  const [partners, stats, latestJobs] = await Promise.all([
    getHomePartners(),
    getHomeStats(),
    getLatestJobs(6),
  ])

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand/5 to-background py-16 md:py-24">
        <div className="container mx-auto max-w-5xl px-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {t('heroTitle')}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            {t('heroSubtitle')}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/jobs"
              prefetch={false}
              className="rounded-md bg-brand px-6 py-2.5 text-sm font-semibold text-brand-foreground hover:bg-brand/90 transition-colors"
            >
              {t('ctaJobs')}
            </Link>
            <Link
              href="/register/student"
              className="rounded-md border border-brand px-6 py-2.5 text-sm font-semibold text-brand hover:bg-brand/5 transition-colors"
            >
              {t('ctaRegister')}
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y bg-muted/30 py-8">
        <div className="container mx-auto max-w-5xl px-4">
          <dl className="flex flex-wrap justify-center gap-8 md:gap-16 text-center">
            <div>
              <dt className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{t('statsCompanies')}</dt>
              <dd className="mt-1 text-3xl font-bold tabular-nums text-foreground">{stats.verifiedCompanyCount}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{t('statsJobs')}</dt>
              <dd className="mt-1 text-3xl font-bold tabular-nums text-foreground">{stats.publishedJobCount}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Value propositions */}
      <section className="py-16">
        <div className="container mx-auto max-w-5xl px-4 grid gap-6 md:grid-cols-2">
          {/* Student */}
          <div className="rounded-2xl bg-gradient-to-br from-brand to-brand/70 p-7 text-white">
            <h2 className="text-xl font-semibold">{t('studentValueTitle')}</h2>
            <ul className="mt-4 space-y-2 text-sm text-white/90">
              <li>· {t('studentValue1')}</li>
              <li>· {t('studentValue2')}</li>
              <li>· {t('studentValue3')}</li>
              <li>· {t('studentValue4')}</li>
            </ul>
            <Link
              href="/register/student"
              className="mt-6 inline-flex items-center gap-1 rounded-full bg-white px-5 py-2 text-sm font-semibold text-brand hover:bg-white/90 transition-colors"
            >
              {t('studentCta')}
            </Link>
          </div>
          {/* Employer */}
          <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-700 p-7 text-white">
            <h2 className="text-xl font-semibold">{t('employerValueTitle')}</h2>
            <ul className="mt-4 space-y-2 text-sm text-white/90">
              <li>· {t('employerValue1')}</li>
              <li>· {t('employerValue2')}</li>
              <li>· {t('employerValue3')}</li>
              <li>· {t('employerValue4')}</li>
            </ul>
            <Link
              href="/for-employers"
              className="mt-6 inline-flex items-center gap-1 rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-white/90 transition-colors"
            >
              {t('employerCta')}
            </Link>
          </div>
        </div>
      </section>

      {/* Latest jobs */}
      <section className="py-12 bg-muted/20">
        <div className="container mx-auto max-w-5xl px-4">
          <h2 className="text-2xl font-semibold text-center mb-8">{t('latestJobsTitle')}</h2>
          {latestJobs.length === 0 ? (
            <p className="text-center text-muted-foreground">{t('latestJobsEmpty')}</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {latestJobs.map((job) => {
                const companyName =
                  locale === 'zh'
                    ? (job.company.displayNameZh ?? job.company.displayNameEn ?? job.company.legalName)
                    : (job.company.displayNameEn ?? job.company.displayNameZh ?? job.company.legalName)
                const salary =
                  job.salaryMin != null && job.salaryMax != null
                    ? `MYR ${job.salaryMin.toLocaleString()}–${job.salaryMax.toLocaleString()}`
                    : job.salaryMin != null
                    ? `MYR ${job.salaryMin.toLocaleString()}+`
                    : t('noSalary')
                return (
                  <li key={job.id} className="rounded-xl border bg-background p-4 hover:shadow-sm transition-shadow">
                    <Link href={`/jobs/${job.id}`} prefetch={false} className="block group">
                      <p className="font-medium text-sm group-hover:text-brand transition-colors line-clamp-2">{job.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{companyName}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {t(`jobType${job.type}`)}
                        </span>
                        {job.state && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {job.state}
                          </span>
                        )}
                        {job.acceptsStudentPass && (
                          <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs">
                            {t('acceptsStudentPass')}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{salary}</p>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-8 text-center">
            <Link
              href="/jobs"
              prefetch={false}
              className="rounded-full border border-border px-8 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              {t('latestJobsMore')}
            </Link>
          </div>
        </div>
      </section>

      {/* Partners wall */}
      {partners.length > 0 && (
        <section className="py-12">
          <div className="container mx-auto max-w-5xl px-4 text-center">
            <h2 className="text-2xl font-semibold">{t('partnersTitle')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('partnersSubtitle')}</p>
            <ul className="mt-8 flex flex-wrap items-center justify-center gap-6">
              {partners.map((p) => {
                const name = locale === 'zh' ? p.name : (p.nameEn ?? p.name)
                const href = safeWebsiteHref(p.website)
                return (
                  <li key={p.id} className="flex items-center gap-2">
                    {p.hasLogo && (
                      <Image
                        src={`/api/partner-logos/${p.id}`}
                        alt=""
                        aria-hidden="true"
                        width={32}
                        height={32}
                        className="size-8 rounded object-contain"
                        unoptimized
                      />
                    )}
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
                      >
                        {name}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-foreground/70">{name}</span>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="mt-6">
              <Link
                href="/partners"
                className="text-sm text-brand hover:underline underline-offset-4 transition-colors"
              >
                {t('partnersMore')}
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* PDPA notice */}
      <section className="py-8 border-t">
        <div className="container mx-auto max-w-5xl px-4">
          <p className="text-xs text-muted-foreground text-center max-w-2xl mx-auto">
            {t('pdpaNotice')}
          </p>
        </div>
      </section>
    </>
  )
}
