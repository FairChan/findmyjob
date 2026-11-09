import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getSetting } from '@/server/services/settings'

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
      <section className="bg-gradient-to-br from-slate-800 to-slate-700 py-16 md:py-24 text-white">
        <div className="container mx-auto max-w-5xl px-4">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('heroTitle')}</h1>
          <p className="mt-4 text-lg text-white/85 max-w-2xl">{t('heroSubtitle')}</p>
          <Link
            href="/register/employer"
            className="mt-8 inline-flex items-center rounded-md bg-white px-6 py-2.5 text-sm font-semibold text-slate-900 hover:bg-white/90 transition-colors"
          >
            {t('ctaButton')}
          </Link>
          <Link href="/pricing" className="mt-4 block w-fit rounded-md px-2 py-2 text-sm font-medium underline underline-offset-4">
            {nav('pricing')}
          </Link>
        </div>
      </section>

      {/* Pilot period banner */}
      <section className="border-b bg-amber-50 py-6">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="rounded-xl border border-amber-200 bg-white p-5">
            <p className="font-semibold text-amber-800">{t('pilotBannerTitle')}</p>
            <p className="mt-2 text-sm text-amber-700">
              {billingEnabled
                ? t('pilotBannerPaid', { monthlyCredits, unlockCost })
                : t('pilotBannerDesc', { monthlyCredits, unlockCost })}
            </p>
          </div>
        </div>
      </section>

      {/* How to get started */}
      <section className="py-16">
        <div className="container mx-auto max-w-5xl px-4">
          <h2 className="text-2xl font-semibold text-center">{t('howTitle')}</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {(['step1', 'step2', 'step3'] as const).map((step) => (
              <li key={step} className="rounded-xl border bg-muted/20 p-6">
                <p className="font-semibold text-brand">{t(`${step}Title`)}</p>
                <p className="mt-2 text-sm text-muted-foreground">{t(`${step}Desc`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="py-12 bg-muted/20 border-y">
        <div className="container mx-auto max-w-5xl px-4">
          <h2 className="text-2xl font-semibold text-center">{t('featuresTitle')}</h2>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2">
            {(['feature1', 'feature2', 'feature3', 'feature4'] as const).map((f) => (
              <li key={f} className="rounded-xl bg-background border p-6">
                <p className="font-semibold">{t(`${f}Title`)}</p>
                <p className="mt-2 text-sm text-muted-foreground">{t(`${f}Desc`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="container mx-auto max-w-5xl px-4 text-center">
          <h2 className="text-2xl font-semibold">{t('ctaTitle')}</h2>
          <p className="mt-3 text-muted-foreground">{t('ctaDesc')}</p>
          <Link
            href="/register/employer"
            className="mt-6 inline-flex items-center rounded-md bg-brand px-6 py-2.5 text-sm font-semibold text-brand-foreground hover:bg-brand/90 transition-colors"
          >
            {t('ctaButton')}
          </Link>
        </div>
      </section>
    </>
  )
}
