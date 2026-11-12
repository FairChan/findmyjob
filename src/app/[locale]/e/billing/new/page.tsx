import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { requireCompanyMember } from '@/server/authz'
import { AppError, ForbiddenError } from '@/server/errors'
import { getBankTransferDetails, quoteOrder, quoteOrderSchema } from '@/server/services/billing'
import { BankDetails } from '../billing-terms'
import { BillingError } from '../billing-error'
import { CreateOrderForm } from './create-order-form'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'billing' })
  return { title: t('quoteTitle'), description: t('quoteDescription') }
}

export default async function NewOrderPage({ params, searchParams }: Props) {
  const { locale } = await params
  let ctx
  try { ctx = await requireCompanyMember('OWNER', await headers()) }
  catch (error) { if (error instanceof ForbiddenError) redirect('/' + locale + '/login'); throw error }
  const t = await getTranslations({ locale, namespace: 'billing' })
  const raw = await searchParams
  const parsed = quoteOrderSchema.safeParse({ planId: raw.planId })
  let quote: Awaited<ReturnType<typeof quoteOrder>> | null = null
  let bank: Awaited<ReturnType<typeof getBankTransferDetails>> = null
  let errorCode = ''
  if (parsed.success) {
    try {
      bank = await getBankTransferDetails(ctx)
      quote = await quoteOrder(ctx, parsed.data)
    } catch (error) {
      if (error instanceof ForbiddenError) redirect('/' + locale + '/login')
      if (!(error instanceof AppError)) throw error
      errorCode = error.code
    }
  }
  return <div className="mx-auto w-full max-w-4xl space-y-6 px-4 pb-20 pt-8 sm:px-6 md:pt-12">
    <header className="space-y-3"><h1 data-testid="billing-heading" tabIndex={-1} className="text-headline">{t('quoteTitle')}</h1><p className="text-body text-muted-foreground">{t('quoteDescription')}</p></header>
    <Link href="/e/billing" className="inline-flex min-h-10 items-center text-sm text-brand underline">{t('backToOrders')}</Link>
    {!parsed.success ? <p role="alert" className="text-sm text-destructive">{t('errorPlan')}</p> : quote ? <CreateOrderForm initialQuote={quote} bank={bank} /> : <div className="space-y-4">
      {!bank && <BankDetails bank={null} />}
      <BillingError code={errorCode || 'UNKNOWN'} operation="quote" />
      <Link href="/pricing" className="inline-flex min-h-10 items-center text-sm text-brand underline">{t('viewPricing')}</Link>
    </div>}
    <p className="text-xs text-muted-foreground">{t('currencyNote')}</p>
  </div>
}
