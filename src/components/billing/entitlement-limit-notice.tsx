'use client'

import { useLocale, useTranslations } from 'next-intl'

interface Props { resource: 'jobs' | 'seats' | 'invitations'; canPurchase?: boolean }
const limitKey = { jobs: 'jobsLimit', seats: 'seatsLimit', invitations: 'invitationsLimit' } as const

export function EntitlementLimitNotice({ resource, canPurchase = false }: Props) {
  const t = useTranslations('entitlements')
  const locale = useLocale()
  return <div data-testid="entitlement-limit-notice" role="alert" className="mt-3 min-w-0 space-y-2 rounded-md bg-destructive/10 p-3 text-sm">
    <p className="text-destructive">{t(limitKey[resource])}</p>
    {canPurchase
      ? <a href={'/' + locale + '/pricing'} className="inline-flex min-h-10 items-center text-blue-800 underline underline-offset-4">{t('viewPlans')}</a>
      : <p className="text-muted-foreground">{t('contactOwner')}</p>}
  </div>
}
