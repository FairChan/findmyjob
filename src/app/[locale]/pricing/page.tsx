import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { listPublicPlans } from '@/server/services/admin-plans'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'pricing' })
  const baseUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: `${baseUrl}/${locale}/pricing`,
      languages: {
        'zh-Hans': `${baseUrl}/zh/pricing`,
        'en': `${baseUrl}/en/pricing`,
        'x-default': `${baseUrl}/zh/pricing`,
      },
    },
  }
}

export default async function PricingPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'pricing' })
  const { billingEnabled, items } = await listPublicPlans()
  const money = new Intl.NumberFormat(locale === 'zh' ? 'zh-Hans-MY' : 'en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return (
    <div className="container mx-auto max-w-6xl space-y-8 px-4 py-8 sm:py-12">
      <header className="max-w-2xl space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-base text-gray-600">{t('description')}</p>
      </header>
      {!billingEnabled && <section aria-labelledby="pricing-pilot-title" className="rounded-xl border border-blue-100 bg-blue-50 p-5 sm:p-6">
        <h2 id="pricing-pilot-title" className="text-xl font-semibold text-blue-950">{t('pilotTitle')}</h2>
        <p className="mt-2 text-sm text-blue-900">{t('pilotDescription')}</p>
      </section>}
      {items.length === 0 ? <p className="rounded-xl border border-gray-200 bg-white p-6 text-gray-600">{t('empty')}</p> : <div className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((plan) => {
          const pack = plan.kind === 'CREDIT_PACK'
          return <article key={plan.id} data-testid={'pricing-plan-' + plan.id} className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
            <p className="text-xs font-semibold text-blue-800">{plan.code === 'FREE' ? t('pilotFree') : pack ? t('kinds.CREDIT_PACK') : t('kinds.PLAN')}</p>
            <h2 className="mt-2 break-words text-xl font-semibold [overflow-wrap:anywhere]">{locale === 'zh' ? plan.nameZh : plan.nameEn}</h2>
            <p data-testid="plan-price" className="mt-5 break-words text-2xl font-bold tabular-nums [overflow-wrap:anywhere]">{plan.priceSen === 0 ? t('free') : 'MYR ' + money.format(plan.priceSen / 100)}</p>
            {pack && <p className="mt-3 text-sm text-gray-600">{t('noSubscription')}</p>}
            <dl className="mt-5 space-y-3 border-t border-gray-100 pt-5 text-sm">
              <div className="flex items-baseline justify-between gap-4"><dt className="text-gray-600">{t('credits')}</dt><dd data-testid="plan-credits" className="font-semibold tabular-nums">{plan.credits}</dd></div>
              {([
                ['durationDays', 'plan-duration'],
                ['jobPostLimit', 'plan-jobs'],
                ['seatLimit', 'plan-seats'],
                ['invitationQuota', 'plan-invitations'],
              ] as const).map(([key, testId]) => <div key={key} className="flex items-baseline justify-between gap-4">
                <dt className="min-w-0 text-gray-600">{t(key)}</dt>
                <dd data-testid={testId} className="min-w-0 text-right font-semibold tabular-nums">{pack ? t('noSubscription') : plan[key] ?? t(key === 'durationDays' ? 'noSubscription' : 'unlimited')}</dd>
              </div>)}
            </dl>
            {billingEnabled && plan.code !== 'FREE' && <Link
              href={`/${locale}/e/billing/new?planId=${encodeURIComponent(plan.id)}`}
              className="mt-5 inline-flex min-h-10 items-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >{t('reviewQuote')}</Link>}
          </article>
        })}
      </div>}
      <p className="text-xs text-gray-600">{t('currencyNote')}</p>
    </div>
  )
}
