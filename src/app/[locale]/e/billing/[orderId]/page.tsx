import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
import { getMyOrder } from '@/server/services/billing'
import { formatKLDateTime } from '@/lib/format-date'
import { AdminActionFeedback } from '@/components/admin/admin-action-feedback'
import { BankDetails, BillingTerms } from '../billing-terms'
import { formatMoney, orderStatusKey } from '../billing-format'
import { CancelOrderDialog } from './cancel-order-dialog'
import { PaymentProofForm } from './payment-proof-form'

interface Props { params: Promise<{ locale: string; orderId: string }> }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'billing' })
  return { title: t('orderTitle'), description: t('orderDescription') }
}

export default async function OrderPage({ params }: Props) {
  const { locale, orderId } = await params
  let ctx
  try { ctx = await requireCompanyMember('OWNER', await headers()) }
  catch (error) { if (error instanceof ForbiddenError) redirect('/' + locale + '/login'); throw error }
  let order
  try { order = await getMyOrder(ctx, { orderId }) }
  catch (error) {
    if (error instanceof ForbiddenError) redirect('/' + locale + '/login')
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound()
    throw error
  }
  const t = await getTranslations({ locale, namespace: 'billing' })
  const bankOrder = order.paymentProvider === 'BANK_TRANSFER' || order.paymentMethod === 'BANK_TRANSFER'
  const canUseBankActions = order.paymentProvider === 'BANK_TRANSFER'
  const needsProof = canUseBankActions && ['PENDING', 'AWAITING_CONFIRMATION'].includes(order.status)
  return <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
    <header className="space-y-2"><h1 data-testid="billing-heading" tabIndex={-1} className="text-2xl font-semibold">{t('orderTitle')}</h1><p className="text-sm text-gray-600">{t('orderDescription')}</p></header>
    <Link href="/e/billing" className="inline-flex min-h-10 items-center text-sm text-blue-700 underline">{t('backToOrders')}</Link>
    <AdminActionFeedback>
      <section data-testid="order-summary" className="min-w-0 space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-gray-600">{t('orderNumber')}</dt><dd data-testid="order-number" className="mt-1 break-all font-semibold">{order.orderNo}</dd></div>
          <div><dt className="text-gray-600">{t('status')}</dt><dd data-testid="order-status" className="mt-1 font-semibold">{t(orderStatusKey(order.status))}</dd></div>
          <div><dt className="text-gray-600">{t('payable')}</dt><dd data-testid="order-amount" className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(order.amountSen)}</dd></div>
          <div><dt className="text-gray-600">{t('createdAt')}</dt><dd className="mt-1"><time dateTime={order.createdAt}>{formatKLDateTime(order.createdAt, locale)}</time></dd></div>
          {order.paidAt && <div><dt className="text-gray-600">{t('paidAt')}</dt><dd className="mt-1"><time dateTime={order.paidAt}>{formatKLDateTime(order.paidAt, locale)}</time></dd></div>}
          <div><dt className="text-gray-600">{t('paymentMethod')}</dt><dd className="mt-1">{bankOrder ? t('bankTransfer') : t('paymentMethodUnknown')}</dd></div>
        </dl>
        {order.commercialSnapshot ? <BillingTerms quote={order.commercialSnapshot} /> : <p className="text-sm text-gray-600">{t('snapshotUnavailable')}</p>}
      </section>
      {needsProof && <>
        <BankDetails bank={order.bankTransfer} historical orderNo={order.orderNo} />
        <PaymentProofForm orderId={order.id} hasProof={order.hasProof} />
      </>}
      {canUseBankActions && order.status === 'PENDING' && !order.hasProof && <CancelOrderDialog orderId={order.id} orderNo={order.orderNo} />}
    </AdminActionFeedback>
  </div>
}
