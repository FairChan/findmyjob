'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { startStripeCheckoutAction } from '@/server/actions/billing'

function trustedCheckoutUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password || url.port) return null
    return url.href
  } catch { return null }
}

export function StripeCheckoutForm({ orderId }: { orderId: string }) {
  const t = useTranslations('billingStripe')
  const locale = useLocale() === 'zh' ? 'zh' : 'en'
  const inFlight = useRef(false)
  const checkoutLink = useRef<HTMLAnchorElement>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)

  useEffect(() => {
    if (checkoutUrl) checkoutLink.current?.focus()
  }, [checkoutUrl])

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || checkoutUrl) return
    inFlight.current = true
    setPending(true)
    setFailure('')
    try {
      const result = await startStripeCheckoutAction({ orderId, locale })
      if (result.ok) {
        const url = result.data.orderId === orderId ? trustedCheckoutUrl(result.data.checkoutUrl) : null
        if (url) setCheckoutUrl(url)
        else setFailure('PAYMENT_REJECTED')
      } else setFailure(result.code)
    } catch { setFailure('UNKNOWN') }
    finally { inFlight.current = false; setPending(false) }
  }

  const errorKey = failure === 'FORBIDDEN' || failure === 'FRESH_SESSION_REQUIRED' || failure === 'TWO_FACTOR_REQUIRED' ? 'errorForbidden'
    : failure === 'NOT_FOUND' ? 'errorNotFound'
      : failure === 'FEATURE_DISABLED' ? 'errorDisabled'
        : failure === 'PAYMENT_UNAVAILABLE' ? 'errorUnavailable'
          : failure === 'PAYMENT_REJECTED' ? 'errorRejected' : 'errorGeneric'

  return <form data-testid="stripe-checkout-form" onSubmit={start} aria-busy={pending} className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
    <p className="text-sm text-gray-600">{t('checkoutNotice')}</p>
    {failure && <p role="alert" className="text-sm text-red-800">{t(errorKey)}</p>}
    {checkoutUrl
      ? <Button asChild className="h-auto min-h-10 whitespace-normal"><a ref={checkoutLink} href={checkoutUrl}>{t('open')}</a></Button>
      : <Button type="submit" disabled={pending} aria-busy={pending} className="h-auto min-h-10 whitespace-normal">{t('start')}</Button>}
  </form>
}
