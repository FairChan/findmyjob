import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError, ValidationError } from '@/server/errors'
import { listMyOrders, listMyOrdersSchema } from '@/server/services/billing'
import { listPublicPlans } from '@/server/services/admin-plans'
import { formatKLDateTime } from '@/lib/format-date'
import { formatMoney, orderStatusKey } from './billing-format'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'billing' })
  return { title: t('title'), description: t('description') }
}

export default async function BillingPage({ params, searchParams }: Props) {
  const { locale } = await params
  let ctx
  try { ctx = await requireCompanyMember('OWNER', await headers()) }
  catch (error) { if (error instanceof ForbiddenError) redirect('/' + locale + '/login'); throw error }
  const t = await getTranslations({ locale, namespace: 'billing' })
  const raw = await searchParams
  const parsed = listMyOrdersSchema.safeParse({ cursor: raw.cursor, limit: typeof raw.limit === 'string' && /^\d+$/.test(raw.limit) ? Number(raw.limit) : raw.limit })
  let invalid = !parsed.success
  let result: Awaited<ReturnType<typeof listMyOrders>> = { items: [], nextCursor: null }
  if (parsed.success) {
    try { result = await listMyOrders(ctx, parsed.data) }
    catch (error) {
      if (error instanceof ForbiddenError) redirect('/' + locale + '/login')
      if (!(error instanceof ValidationError)) throw error
      invalid = true
    }
  }
  const products = await listPublicPlans()
  const path = '/' + locale + '/e/billing'
  const next = new URLSearchParams()
  if (parsed.success && parsed.data.limit !== undefined) next.set('limit', String(parsed.data.limit))
  if (result.nextCursor) next.set('cursor', result.nextCursor)
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
    <header className="space-y-2"><h1 data-testid="billing-heading" tabIndex={-1} className="text-2xl font-semibold">{t('title')}</h1><p className="text-sm text-gray-600">{t('description')}</p></header>
    <Link href="/pricing" className="inline-flex min-h-10 items-center text-sm text-blue-700 underline">{t('viewPricing')}</Link>
    {!products.billingEnabled && <p className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">{t('salesUnavailable')}</p>}
    {products.billingEnabled && <div className="grid gap-3 sm:grid-cols-2">
      {products.items.filter((plan) => plan.code !== 'FREE').map((plan) => <article key={plan.id} className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="break-words font-semibold [overflow-wrap:anywhere]">{locale === 'zh' ? plan.nameZh : plan.nameEn}</h2>
        <p className="mt-2 text-sm tabular-nums">{formatMoney(plan.priceSen)}</p>
        <Link href={'/e/billing/new?planId=' + encodeURIComponent(plan.id)} className="mt-3 inline-flex min-h-10 items-center text-sm text-blue-700 underline">{t('create')}</Link>
      </article>)}
    </div>}
    {invalid ? <div className="space-y-2"><p role="alert" className="text-sm text-red-800">{t('errorQuery')}</p><a href={path} className="inline-flex min-h-10 items-center text-sm text-blue-700 underline">{t('reset')}</a></div> : <div className="space-y-3">
      {!result.items.length && <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">{t('empty')}</p>}
      {result.items.map((order) => <article key={order.id} className="min-w-0 space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="break-words font-semibold [overflow-wrap:anywhere]">{order.plan ? locale === 'zh' ? order.plan.nameZh : order.plan.nameEn : t('snapshotUnavailable')}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-gray-600">{t('orderNumber')}</dt><dd className="break-all">{order.orderNo}</dd></div>
          <div><dt className="text-gray-600">{t('status')}</dt><dd>{t(orderStatusKey(order.status))}</dd></div>
          <div><dt className="text-gray-600">{t('payable')}</dt><dd className="font-semibold tabular-nums">{formatMoney(order.amountSen)}</dd></div>
          <div><dt className="text-gray-600">{t('createdAt')}</dt><dd>{formatKLDateTime(order.createdAt, locale)}</dd></div>
        </dl>
        <Link href={'/e/billing/' + encodeURIComponent(order.id)} className="inline-flex min-h-10 items-center text-sm text-blue-700 underline">{t('viewOrder')}</Link>
      </article>)}
    </div>}
    {!invalid && result.nextCursor && <a href={path + '?' + next.toString()} className="inline-flex min-h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm">{t('next')}</a>}
  </div>
}
