import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
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
    <div className="page-shell max-w-6xl pb-20 pt-10 md:pt-14">
      <PageHeader title={t('title')} lead={t('description')} />
      {!billingEnabled && <section aria-labelledby="pricing-pilot-title" className="mt-8 rounded-card bg-brand-muted p-6 sm:p-7">
        <h2 id="pricing-pilot-title" className="text-title text-brand-muted-foreground">{t('pilotTitle')}</h2>
        <p className="mt-2 text-sm text-brand-muted-foreground">{t('pilotDescription')}</p>
      </section>}
      {items.length === 0 ? <p className="mt-8 rounded-card bg-muted p-6 text-muted-foreground">{t('empty')}</p> : <div className="mt-8 grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((plan) => {
          const pack = plan.kind === 'CREDIT_PACK'
          return <article key={plan.id} data-testid={'pricing-plan-' + plan.id} className="flex min-w-0 flex-col rounded-tile bg-muted p-6 sm:p-8">
            <p className="text-xs font-semibold text-brand-muted-foreground">{plan.code === 'FREE' ? t('pilotFree') : pack ? t('kinds.CREDIT_PACK') : t('kinds.PLAN')}</p>
            <h2 className="mt-2 break-words text-title [overflow-wrap:anywhere]">{locale === 'zh' ? plan.nameZh : plan.nameEn}</h2>
            <p data-testid="plan-price" className="mt-5 break-words text-headline tabular-nums [overflow-wrap:anywhere]">{plan.priceSen === 0 ? t('free') : 'MYR ' + money.format(plan.priceSen / 100)}</p>
            {pack && <p className="mt-3 text-sm text-muted-foreground">{t('noSubscription')}</p>}
            <dl className="mt-6 space-y-3 border-t pt-6 text-sm">
              <div className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">{t('credits')}</dt><dd data-testid="plan-credits" className="font-semibold tabular-nums">{plan.credits}</dd></div>
              {([
                ['durationDays', 'plan-duration'],
                ['jobPostLimit', 'plan-jobs'],
                ['seatLimit', 'plan-seats'],
                ['invitationQuota', 'plan-invitations'],
              ] as const).map(([key, testId]) => <div key={key} className="flex items-baseline justify-between gap-4">
                <dt className="min-w-0 text-muted-foreground">{t(key)}</dt>
                <dd data-testid={testId} className="min-w-0 text-right font-semibold tabular-nums">{pack ? t('noSubscription') : plan[key] ?? t(key === 'durationDays' ? 'noSubscription' : 'unlimited')}</dd>
              </div>)}
            </dl>
            {billingEnabled && plan.code !== 'FREE' && <Button asChild variant="brand" className="mt-6 self-start">
              <Link href={`/${locale}/e/billing/new?planId=${encodeURIComponent(plan.id)}`}>{t('reviewQuote')}</Link>
            </Button>}
          </article>
        })}
      </div>}
      <p className="mt-8 text-xs text-muted-foreground">{t('currencyNote')}</p>
    </div>
  )
}
