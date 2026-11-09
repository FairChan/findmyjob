'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { getCompanyEntitlementUsage } from '@/server/services/subscription-entitlements'
import { formatKLDateTime } from '@/lib/format-date'

type Usage = Awaited<ReturnType<typeof getCompanyEntitlementUsage>>
interface Props { usage: Usage; resource: 'jobs' | 'seats' | 'invitations' }
const sourceKey = { SUBSCRIPTION: 'sourceSubscription', FREE: 'sourceFree', PILOT: 'sourcePilot' } as const
const retainedKey = { jobs: 'jobsRetained', seats: 'seatsRetained', invitations: 'invitationsRetained' } as const

export function CompanyEntitlementSummary({ usage, resource }: Props) {
  const t = useTranslations('entitlements')
  const locale = useLocale()
  const { used, limit } = usage[resource]
  const reserved = resource === 'seats' ? usage.seats.reserved : 0
  const atLimit = limit !== null && used + reserved >= limit
  const endsAt = usage.source === 'SUBSCRIPTION' && usage.effectiveUntil && Number.isFinite(new Date(usage.effectiveUntil).getTime())
    ? usage.effectiveUntil : null

  return <section data-testid="entitlement-usage" aria-label={t('title')} className="mb-6 min-w-0 space-y-3 rounded-lg border bg-muted/30 p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold">{t(resource)}</h2>
      <p className="text-xs text-muted-foreground">{t(sourceKey[usage.source])}</p>
    </div>
    <p className="text-base font-semibold tabular-nums">{limit === null ? t('unlimitedUsage', { used }) : t('finiteUsage', { used, limit })}</p>
    {resource === 'seats' && reserved > 0 && <p className="text-sm text-muted-foreground">{t('reservedSeats', { reserved })}</p>}
    {atLimit && <p className="text-sm text-muted-foreground">{t(retainedKey[resource])}</p>}
    {endsAt && <p className="text-sm text-muted-foreground"><time dateTime={endsAt}>{t('effectiveUntil', { date: formatKLDateTime(endsAt, locale) })}</time></p>}
    {usage.canPurchase && usage.source !== 'PILOT' && <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      <a href={'/' + locale + '/pricing'} className="inline-flex min-h-10 items-center text-brand underline underline-offset-4">{t('viewPlans')}</a>
      <a href={'/' + locale + '/e/billing'} className="inline-flex min-h-10 items-center text-brand underline underline-offset-4">{t('manageBilling')}</a>
    </div>}
  </section>
}
