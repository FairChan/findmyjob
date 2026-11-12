import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getSetting } from '@/server/services/settings'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Section, SectionHeader } from '@/components/ui/section'
import { TextLink } from '@/components/ui/text-link'

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'forEmployers' })
  const baseUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: `${baseUrl}/${locale}/for-employers`,
      languages: {
        'zh-Hans': `${baseUrl}/zh/for-employers`,
        'en': `${baseUrl}/en/for-employers`,
        'x-default': `${baseUrl}/zh/for-employers`,
      },
    },
  }
}

export default async function ForEmployersPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'forEmployers' })
  const nav = await getTranslations({ locale, namespace: 'nav' })

  const [billingEnabled, monthlyCredits, unlockCost] = await Promise.all([
    getSetting<boolean>('billing.enabled', false),
    getSetting<number>('pilot.monthlyCredits', 30),
    getSetting<number>('unlock.costCredits', 1),
  ])

  return (
    <>
      {/* Hero */}
      <section className="bg-background pb-16 pt-16 md:pb-24 md:pt-24">
        <div className="page-shell">
          <h1 className="max-w-4xl text-display text-balance">{t('heroTitle')}</h1>
          <p className="mt-6 max-w-2xl text-lead text-muted-foreground text-pretty">{t('heroSubtitle')}</p>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button asChild variant="brand" size="lg">
              <Link href="/register/employer">{t('ctaButton')}</Link>
            </Button>
            <TextLink href="/pricing" className="text-body">
              {nav('pricing')}
            </TextLink>
          </div>

          {/* Pilot period notice */}
          <div className="mt-14 rounded-card bg-brand-muted p-6 sm:p-7">
            <p className="text-body font-semibold text-brand-muted-foreground">{t('pilotBannerTitle')}</p>
            <p className="mt-2 text-sm text-brand-muted-foreground">
              {billingEnabled
                ? t('pilotBannerPaid', { monthlyCredits, unlockCost })
                : t('pilotBannerDesc', { monthlyCredits, unlockCost })}
            </p>
          </div>
        </div>
      </section>

      {/* How to get started: the step titles carry their own numbers. */}
      <Section tone="muted">
        <SectionHeader title={t('howTitle')} />
        <ol className="grid gap-4 md:grid-cols-3">
          {(['step1', 'step2', 'step3'] as const).map((step) => (
            <li key={step}>
              <Card surface="plain" size="tile" className="h-full">
                <p className="text-title">{t(`${step}Title`)}</p>
                <p className="mt-2 text-sm text-muted-foreground">{t(`${step}Desc`)}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      {/* Features */}
      <Section>
        <SectionHeader title={t('featuresTitle')} />
        <ul className="grid gap-4 sm:grid-cols-2">
          {(['feature1', 'feature2', 'feature3', 'feature4'] as const).map((f) => (
            <li key={f}>
              <Card size="tile" className="h-full">
                <p className="text-title">{t(`${f}Title`)}</p>
                <p className="mt-2 text-sm text-muted-foreground">{t(`${f}Desc`)}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      {/* CTA */}
      <Section className="pt-0 md:pt-0">
        <Card surface="inverse" size="tile" className="flex flex-col items-start gap-6 md:p-14">
          <div>
            <h2 className="text-headline text-balance">{t('ctaTitle')}</h2>
            <p className="mt-3 max-w-2xl text-body text-background/80">{t('ctaDesc')}</p>
          </div>
          <Button asChild variant="secondary" size="lg">
            <Link href="/register/employer">{t('ctaButton')}</Link>
          </Button>
        </Card>
      </Section>
    </>
  )
}
