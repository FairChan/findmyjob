import type { Metadata } from 'next'
import Image from 'next/image'
import { BadgeCheck, Eye, FileText, Quote, Search, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getHomePartners } from '@/server/services/admin-schools-partners'
import { getHomeStats, getLatestJobs } from '@/server/services/home'
import { getMemberIdentity } from '@/server/services/member-identity'
import { safeWebsiteHref } from '@/lib/url-utils'
import { HeroFloating } from '@/components/home/hero-floating'
import { HeroWord } from '@/components/home/hero-word'
import { HomeRecruiterRail } from '@/components/home/home-recruiter-rail'
import { JobCard } from '@/components/jobs/job-card'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Section, SectionHeader } from '@/components/ui/section'
import { TextLink } from '@/components/ui/text-link'

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

const STUDENT_VALUES = [
  { key: 'studentValue1', Icon: FileText, wide: false },
  { key: 'studentValue2', Icon: Eye, wide: true },
  { key: 'studentValue3', Icon: BadgeCheck, wide: true },
  { key: 'studentValue4', Icon: Users, wide: false },
] as const

const TESTIMONIALS = ['a', 'b', 'c'] as const

// The first word is the resting one and matches the sentence read to assistive tech.
const HERO_WORD_KEYS = ['w1', 'w2', 'w3', 'w4'] as const

const EMPLOYER_VALUES = ['employerValue1', 'employerValue2', 'employerValue3', 'employerValue4'] as const

export default async function HomePage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'home' })

  const [partners, stats, latestJobs, member, showcase] = await Promise.all([
    getHomePartners(),
    getHomeStats(),
    getLatestJobs(6),
    getMemberIdentity(),
    getTranslations({ locale, namespace: 'publicShowcase' }),
  ])

  const heroWords = HERO_WORD_KEYS.map((key) => t(`heroWords.${key}`))
  // Chinese states the setting first; English ends on it.
  const contextFirst = locale === 'zh'
  const heroContext = <span className="block text-muted-foreground">{t('heroContext')}</span>

  return (
    <>
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-background pb-16 pt-16 md:pb-24 md:pt-28">
        <HeroFloating />
        <div className="page-shell relative z-10 text-center">
          <h1 className="text-display text-balance">
            <span className="sr-only">{t('heroTitle')}</span>
            <span aria-hidden="true">
              {contextFirst && heroContext}
              <span className="block">
                {t('heroLead')}
                <HeroWord words={heroWords} />
                {t('heroTail')}
              </span>
              {!contextFirst && heroContext}
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lead text-muted-foreground text-pretty">
            {t('heroSubtitle')}
          </p>

          {member?.role === 'STUDENT' ? <form
            action={`/${locale}/s/jobs`}
            method="get"
            role="search"
            className="mx-auto mt-10 flex max-w-xl items-center gap-2 rounded-full bg-muted p-1.5 pl-5 focus-within:ring-2 focus-within:ring-ring"
          >
            <Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            <label htmlFor="home-job-search" className="sr-only">
              {t('searchLabel')}
            </label>
            <input
              id="home-job-search"
              type="search"
              name="q"
              maxLength={100}
              placeholder={t('searchPlaceholder')}
              className="h-11 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
            />
            <Button type="submit" variant="brand" className="h-11 px-6">
              {t('searchSubmit')}
            </Button>
          </form> : <div className="mt-10 flex justify-center">
            <Button asChild variant="brand" size="lg">
              <Link href={member?.role === 'EMPLOYER' ? '/e' : `/login?redirect=${encodeURIComponent(`/${locale}/s/jobs`)}`} prefetch={false}>
                {member?.role === 'EMPLOYER' ? t('employerCta') : showcase('jobsCta')}
              </Link>
            </Button>
          </div>}

          <div className="mt-6 flex flex-wrap justify-center gap-x-8 gap-y-2 text-body">
            <TextLink href="/register/student">{t('ctaRegister')}</TextLink>
            <TextLink href="/jobs" prefetch={false}>
              {t('ctaJobs')}
            </TextLink>
          </div>

          <dl className="mt-12 flex justify-center divide-x text-sm text-muted-foreground md:mt-16">
            <div className="flex items-baseline gap-2 px-6">
              <dd className="text-title tabular-nums text-foreground">{stats.verifiedCompanyCount}</dd>
              <dt>{t('statsCompanies')}</dt>
            </div>
            <div className="flex items-baseline gap-2 px-6">
              <dd className="text-title tabular-nums text-foreground">{stats.publishedJobCount}</dd>
              <dt>{t('statsJobs')}</dt>
            </div>
          </dl>
        </div>
      </section>

      {/* For students */}
      <Section tone="muted">
        <SectionHeader
          title={t('studentValueTitle')}
          action={
            <Button asChild variant="brand">
              <Link href="/register/student">{t('studentCta')}</Link>
            </Button>
          }
        />
        <ul className="grid gap-4 md:grid-cols-3">
          {STUDENT_VALUES.map(({ key, Icon, wide }) => (
            <li key={key} className={wide ? 'md:col-span-2' : undefined}>
              <Card surface="plain" size="tile" className="flex h-full min-h-44 flex-col justify-between gap-8">
                <Icon aria-hidden="true" className="size-7 text-brand" strokeWidth={1.75} />
                <p className="max-w-md text-title text-pretty">{t(key)}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      {/* Latest jobs */}
      <Section>
        <SectionHeader
          title={t('latestJobsTitle')}
          action={
            <TextLink href="/jobs" prefetch={false} className="text-body">
              {t('latestJobsMore')}
            </TextLink>
          }
        />
        {latestJobs.length === 0 ? (
          <EmptyState
            title={t('latestJobsEmpty')}
            description={t('latestJobsEmptyHint')}
            action={<TextLink href="/companies">{t('browseCompanies')}</TextLink>}
          />
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
                <li key={job.id}>
                  <JobCard
                    jobId={job.id}
                    title={job.title}
                    company={companyName}
                    salary={salary}
                    badges={[
                      { label: t(`jobType${job.type}`) },
                      ...(job.state ? [{ label: job.state }] : []),
                      ...(job.acceptsStudentPass
                        ? [{ label: t('acceptsStudentPass'), tone: 'success' as const }]
                        : []),
                    ]}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <HomeRecruiterRail />

      {/* What students say: sample content until real feedback is collected. */}
      <Section>
        <SectionHeader title={t('testimonials.title')} lead={t('testimonials.demoNotice')} />
        <ul className="grid gap-4 md:grid-cols-3">
          {TESTIMONIALS.map((key) => (
            <li key={key}>
              <Card size="tile" className="flex h-full flex-col">
                <Quote aria-hidden="true" className="size-7 text-brand" strokeWidth={1.75} />
                <blockquote className="mt-6 text-title text-pretty">{t(`testimonials.items.${key}.quote`)}</blockquote>
                <p className="mt-auto pt-8 text-sm">
                  <span className="font-semibold">{t(`testimonials.items.${key}.name`)}</span>
                  <span className="text-muted-foreground"> · {t(`testimonials.items.${key}.meta`)}</span>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      {/* For employers */}
      <Section className="pt-0 md:pt-0">
        <Card surface="inverse" size="tile" className="grid gap-10 md:grid-cols-[1fr_1.15fr] md:gap-14 md:p-14">
          <div className="flex flex-col items-start justify-between gap-8">
            <h2 className="text-headline text-balance">{t('employerValueTitle')}</h2>
            <Button asChild variant="secondary" size="lg">
              <Link href="/for-employers">{t('employerCta')}</Link>
            </Button>
          </div>
          <ul className="divide-y divide-background/15 border-y border-background/15">
            {EMPLOYER_VALUES.map((key) => (
              <li key={key} className="py-4 text-body text-background/85">
                {t(key)}
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      {/* Partners wall */}
      {partners.length > 0 && (
        <Section tone="muted">
          <SectionHeader
            align="center"
            title={t('partnersTitle')}
            lead={t('partnersSubtitle')}
          />
          <ul className="flex flex-wrap items-center justify-center gap-3">
            {partners.map((p) => {
              const name = locale === 'zh' ? p.name : (p.nameEn ?? p.name)
              const href = safeWebsiteHref(p.website)
              return (
                <li
                  key={p.id}
                  className="flex min-h-12 items-center gap-2.5 rounded-full bg-background px-5 text-sm font-medium"
                >
                  {p.hasLogo && (
                    <Image
                      src={`/api/partner-logos/${p.id}`}
                      alt=""
                      aria-hidden="true"
                      width={32}
                      height={32}
                      className="size-7 rounded object-contain"
                      unoptimized
                    />
                  )}
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex min-h-6 items-center hover:text-brand"
                    >
                      {name}
                    </a>
                  ) : (
                    <span>{name}</span>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="mt-8 text-center">
            <TextLink href="/partners">{t('partnersMore')}</TextLink>
          </div>
        </Section>
      )}

      {/* PDPA notice */}
      <Section tone="muted" spacing="compact" className="border-t">
        <p className="mx-auto max-w-2xl text-center text-xs text-muted-foreground text-pretty">
          {t('pdpaNotice')}
        </p>
      </Section>
    </>
  )
}
