import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { ForbiddenError, TwoFactorRequiredError, ValidationError } from '@/server/errors'
import { listOrdersAdmin, listOrdersAdminSchema } from '@/server/services/billing'
import { AdminActionFeedback } from '@/components/admin/admin-action-feedback'
import { Button } from '@/components/ui/button'
import { formatKLDateTime } from '@/lib/format-date'
import { formatMoney } from '../../e/billing/billing-format'
import { ConfirmOrderDialog } from './confirm-order-dialog'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminOrders' })
  return { title: t('title'), description: t('description') }
}

export default async function AdminOrdersPage({ params, searchParams }: Props) {
  const { locale } = await params
  let ctx
  try { ctx = await requireAdmin(await headers()) }
  catch (error) {
    if (error instanceof TwoFactorRequiredError) redirect('/' + locale + '/two-factor/setup')
    if (error instanceof ForbiddenError) redirect('/' + locale + '/login')
    throw error
  }
  const t = await getTranslations({ locale, namespace: 'adminOrders' })
  const raw = await searchParams
  const parsed = listOrdersAdminSchema.safeParse({
    status: raw.status ?? 'AWAITING_CONFIRMATION', cursor: raw.cursor,
    limit: typeof raw.limit === 'string' && /^\d+$/.test(raw.limit) ? Number(raw.limit) : raw.limit,
  })
  let invalid = !parsed.success
  let result: Awaited<ReturnType<typeof listOrdersAdmin>> = { items: [], nextCursor: null }
  if (parsed.success) {
    try { result = await listOrdersAdmin(ctx, parsed.data) }
    catch (error) {
      if (error instanceof ForbiddenError) redirect('/' + locale + '/login')
      if (!(error instanceof ValidationError)) throw error
      invalid = true
    }
  }
  const query = parsed.success ? parsed.data : {}
  const path = '/' + locale + '/admin/orders'
  const next = new URLSearchParams()
  next.set('status', query.status ?? 'AWAITING_CONFIRMATION')
  if (query.limit !== undefined) next.set('limit', String(query.limit))
  if (result.nextCursor) next.set('cursor', result.nextCursor)
  return <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header className="space-y-2"><h1 data-testid="admin-orders-heading" tabIndex={-1} className="text-2xl font-semibold">{t('title')}</h1><p className="text-sm text-muted-foreground">{t('description')}</p></header>
    <AdminActionFeedback>
      <form method="GET" action={path} className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-card p-4">
        <div className="min-w-0 basis-full space-y-1 sm:basis-auto sm:flex-1"><label htmlFor="order-status-filter" className="text-sm font-medium">{t('status')}</label><select key={query.status ?? 'AWAITING_CONFIRMATION'} id="order-status-filter" name="status" defaultValue={query.status ?? 'AWAITING_CONFIRMATION'} className="h-10 w-full rounded-card border border-border bg-card px-3 text-base focus-visible:outline-2 focus-visible:outline-brand">
          <option value="ALL">{t('all')}</option>
          {(['PENDING', 'AWAITING_CONFIRMATION', 'PAID', 'CANCELLED', 'REFUNDED'] as const).map((status) => <option key={status} value={status}>{t('statuses.' + status)}</option>)}
        </select></div>
        {query.limit !== undefined && <input type="hidden" name="limit" value={query.limit} />}
        <Button type="submit">{t('filter')}</Button><a href={path} className="inline-flex min-h-10 items-center text-sm text-brand underline">{t('reset')}</a>
      </form>
      {invalid ? <p role="alert" className="rounded-card border border-destructive/30 bg-card p-4 text-sm text-destructive">{t('errorQuery')}</p> : <div className="space-y-3">
        {!result.items.length && <p className="rounded-card border border-border bg-card p-6 text-sm text-muted-foreground">{t('empty')}</p>}
        {result.items.map((order) => <article key={order.id} data-testid={'admin-order-' + order.id} className="min-w-0 space-y-4 rounded-card border border-border bg-card p-4 sm:p-5">
          <h2 className="break-words font-semibold [overflow-wrap:anywhere]">{order.orderNo}</h2>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-muted-foreground">{t('company')}</dt><dd className="mt-1 break-words [overflow-wrap:anywhere]">{order.company.displayName}</dd></div>
            <div><dt className="text-muted-foreground">{t('product')}</dt><dd className="mt-1 break-words [overflow-wrap:anywhere]">{order.plan ? locale === 'zh' ? order.plan.nameZh : order.plan.nameEn : t('snapshotUnavailable')}</dd></div>
            <div><dt className="text-muted-foreground">{t('status')}</dt><dd className="mt-1 font-medium">{t('statuses.' + order.status)}</dd></div>
            <div><dt className="text-muted-foreground">{t('payable')}</dt><dd className="mt-1 font-semibold tabular-nums">{formatMoney(order.amountSen)}</dd></div>
            <div><dt className="text-muted-foreground">{t('discount')}</dt><dd className="mt-1 tabular-nums">{formatMoney(order.discountSen)}</dd></div>
            <div><dt className="text-muted-foreground">{t('createdAt')}</dt><dd className="mt-1">{formatKLDateTime(order.createdAt, locale)}</dd></div>
          </dl>
          <div className="flex flex-wrap items-center gap-4">
            {order.hasProof ? <a href={'/api/admin/orders/' + encodeURIComponent(order.id) + '/payment-proof'} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center text-sm text-brand underline">{t('preview')}</a> : <p className="text-sm text-muted-foreground">{t('noProof')}</p>}
            {order.status === 'AWAITING_CONFIRMATION' && order.hasProof && order.paymentProvider === 'BANK_TRANSFER' && <ConfirmOrderDialog orderId={order.id} orderNo={order.orderNo} amountSen={order.amountSen} />}
          </div>
          {order.hasProof && <p className="text-xs text-muted-foreground">{t('previewHint')}</p>}
        </article>)}
      </div>}
      {!invalid && result.nextCursor && <a href={path + '?' + next.toString()} className="inline-flex min-h-10 items-center rounded-card border border-border bg-card px-4 text-sm">{t('next')}</a>}
    </AdminActionFeedback>
  </div>
}
