'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { BankTransferDetails, OrderQuoteV1 } from '@/server/services/billing'
import { formatMoney } from './billing-format'

export function BillingTerms({ quote, quoteIds = false }: { quote: OrderQuoteV1; quoteIds?: boolean }) {
  const t = useTranslations('billing')
  const locale = useLocale()
  const subscription = quote.delivery.subscription
  return (
    <section className="min-w-0 space-y-4">
      <h2 className="break-words text-title [overflow-wrap:anywhere]">{locale === 'zh' ? quote.plan.nameZh : quote.plan.nameEn}</h2>
      {quote.promotion && <p className="text-sm font-medium text-brand">{t('foundingOffer')}</p>}
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {([
          ['listPrice', quote.money.listPriceSen, 'quote-list-price'],
          ['discount', quote.money.discountSen, 'quote-discount'],
          ['payable', quote.money.payableSen, 'quote-payable'],
        ] as const).map(([label, value, testId]) => <div key={label} className="min-w-0 rounded-card bg-muted p-3"><dt className="text-sm text-muted-foreground">{t(label)}</dt><dd data-testid={quoteIds ? testId : undefined} className="mt-1 break-words text-lg font-semibold tabular-nums">{formatMoney(value)}</dd></div>)}
      </dl>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">{t('credits')}</dt><dd data-testid={quoteIds ? 'quote-credits' : undefined} className="mt-1 font-semibold">{quote.delivery.credits}</dd></div>
        {subscription && <>
          <div><dt className="text-muted-foreground">{t('durationDays')}</dt><dd className="mt-1 font-semibold">{subscription.durationDays}</dd></div>
          {(['jobPostLimit', 'seatLimit', 'invitationQuota'] as const).map((key) => <div key={key}><dt className="text-muted-foreground">{t(key)}</dt><dd className="mt-1 font-semibold">{subscription[key] ?? t('unlimited')}</dd></div>)}
        </>}
      </dl>
      {!subscription && <p className="text-sm text-muted-foreground">{t('noSubscription')}</p>}
      {!!subscription?.manualBenefits.length && <div><h3 className="text-sm font-semibold">{t('manualBenefits')}</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{subscription.manualBenefits.map((benefit, index) => <li key={index} className="break-words">{benefit}</li>)}</ul></div>}
    </section>
  )
}

export function BankDetails({ bank, historical = false, orderNo }: { bank: BankTransferDetails | null; historical?: boolean; orderNo?: string }) {
  const t = useTranslations('billing')
  if (!bank) return <p data-testid="bank-transfer-unavailable" className="rounded-card border border-warning/30 bg-warning-muted p-4 text-sm text-warning">{t(historical ? 'bankHistory' : 'bankUnavailable')}</p>
  return <section data-testid="bank-transfer-details" className="min-w-0 space-y-3 rounded-card border border-border bg-muted p-4">
    <h2 className="font-semibold">{t('bankDetailsTitle')}</h2>
    <dl className="space-y-3 text-sm">
      {(['bankName', 'accountName', 'accountNumber'] as const).map((key) => <div key={key}><dt className="text-muted-foreground">{t(key)}</dt><dd className="mt-1 whitespace-pre-wrap break-words font-medium [overflow-wrap:anywhere]">{bank[key]}</dd></div>)}
      {bank.instructions && <div><dt className="text-muted-foreground">{t('instructions')}</dt><dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{bank.instructions}</dd></div>}
    </dl>
    {orderNo && <p className="break-words text-sm [overflow-wrap:anywhere]">{t('transferReference', { orderNo })}</p>}
  </section>
}
