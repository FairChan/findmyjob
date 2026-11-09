'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { createOrderAction, quoteOrderAction } from '@/server/actions/billing'
import type { BankTransferDetails, OrderQuoteV1 } from '@/server/services/billing'
import { BankDetails, BillingTerms } from '../billing-terms'
import { BillingError } from '../billing-error'

export function CreateOrderForm({ initialQuote, bank }: { initialQuote: OrderQuoteV1; bank: BankTransferDetails | null }) {
  const t = useTranslations('billing')
  const router = useRouter()
  const inFlight = useRef(false)
  const completed = useRef(false)
  const [quote, setQuote] = useState(initialQuote)
  const [pending, setPending] = useState<'create' | 'quote' | null>(null)
  const [failure, setFailure] = useState({ code: '', operation: 'create' as 'create' | 'quote' })
  const [salesClosed, setSalesClosed] = useState(false)

  async function refreshQuote() {
    if (inFlight.current || completed.current) return
    inFlight.current = true
    setPending('quote')
    setFailure({ code: '', operation: 'quote' })
    try {
      const result = await quoteOrderAction({ planId: quote.plan.id })
      if (result.ok) { setQuote(result.data); setSalesClosed(false) }
      else { setFailure({ code: result.code, operation: 'quote' }); if (result.code === 'FEATURE_DISABLED') setSalesClosed(true) }
    } catch { setFailure({ code: 'UNKNOWN', operation: 'quote' }) }
    finally { inFlight.current = false; setPending(null) }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || completed.current || !bank || salesClosed) return
    inFlight.current = true
    setPending('create')
    setFailure({ code: '', operation: 'create' })
    try {
      const result = await createOrderAction({ planId: quote.plan.id, method: 'BANK_TRANSFER', acceptedQuote: quote })
      if (result.ok) {
        completed.current = true
        router.push('/e/billing/' + encodeURIComponent(result.data.orderId))
      } else {
        setFailure({ code: result.code, operation: 'create' })
        if (result.code === 'FEATURE_DISABLED') setSalesClosed(true)
      }
    } catch { setFailure({ code: 'UNKNOWN', operation: 'create' }) }
    finally { inFlight.current = false; if (!completed.current) setPending(null) }
  }

  return <form data-testid="billing-quote" onSubmit={create} aria-busy={pending !== null} className="min-w-0 space-y-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
    <BillingTerms quote={quote} quoteIds />
    {!salesClosed && <BankDetails bank={bank} />}
    <p className="text-sm text-gray-600">{t('createNotice')}</p>
    <BillingError code={failure.code} operation={failure.operation} />
    <div className="flex flex-wrap gap-3">
      <Button type="submit" disabled={pending !== null || !bank || salesClosed} aria-busy={pending === 'create'} className="h-auto min-h-10 whitespace-normal">{t('create')}</Button>
      {failure.code && <Button type="button" variant="outline" disabled={pending !== null} onClick={refreshQuote} className="h-auto min-h-10 whitespace-normal">{t(pending === 'quote' ? 'refreshingQuote' : 'refreshQuote')}</Button>}
    </div>
  </form>
}
