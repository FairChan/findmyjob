import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { requireCompanyMember } from '@/server/authz'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
import { getMyOrder } from '@/server/services/billing'
import type { StripePaymentViewState } from '@/server/payments/types'
import { formatKLDateTime } from '@/lib/format-date'
import { AdminActionFeedback } from '@/components/admin/admin-action-feedback'
import { BankDetails, BillingTerms } from '../billing-terms'
import { formatMoney, orderStatusKey } from '../billing-format'
import { CancelOrderDialog } from './cancel-order-dialog'
import { PaymentProofForm } from './payment-proof-form'
import { StripeCheckoutForm } from './stripe-checkout-form'

const stripeStateKey = {
  NOT_STARTED: 'stateNotStarted', CREATING: 'stateCreating', OPEN: 'stateOpen',
  PROCESSING: 'stateProcessing', SUCCEEDED: 'stateSucceeded', FAILED: 'stateFailed',
  EXPIRED: 'stateExpired', RECONCILIATION_REQUIRED: 'stateReconciliation',
} as const satisfies Record<StripePaymentViewState, string>

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
  const stripe = await getTranslations({ locale, namespace: 'billingStripe' })
  const bankOrder = order.paymentProvider === 'BANK_TRANSFER' || order.paymentMethod === 'BANK_TRANSFER'
  const stripeOrder = order.paymentProvider === 'STRIPE'
  const canUseBankActions = order.paymentProvider === 'BANK_TRANSFER'
  const needsProof = canUseBankActions && ['PENDING', 'AWAITING_CONFIRMATION'].includes(order.status)
  const paymentState = stripeOrder ? order.stripePayment?.state : undefined
  const canContinueCheckout = order.status === 'PENDING' && paymentState !== undefined && ['NOT_STARTED', 'CREATING', 'OPEN'].includes(paymentState)
  const receipt = stripeOrder && order.status === 'PAID' && order.paymentMethod === 'FPX' && paymentState === 'SUCCEEDED'
    ? order.stripePayment?.fpxReceipt : null
  const showReceipt = receipt?.status === 'succeeded' && receipt.orderNo === order.orderNo
    && receipt.amountSen === order.amountSen && receipt.currency === order.currency
    && Number.isFinite(new Date(receipt.createdAt).getTime())
  const paymentMethod = stripeOrder
    ? stripe(order.paymentMethod === 'FPX' ? 'paymentMethodFpx' : order.paymentMethod === 'CARD' ? 'paymentMethodCard' : 'paymentMethodStripe')
    : bankOrder ? t('bankTransfer') : t('paymentMethodUnknown')
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
          <div><dt className="text-gray-600">{t('paymentMethod')}</dt><dd className="mt-1">{paymentMethod}</dd></div>
        </dl>
        {order.commercialSnapshot ? <BillingTerms quote={order.commercialSnapshot} /> : <p className="text-sm text-gray-600">{t('snapshotUnavailable')}</p>}
      </section>
      {stripeOrder && paymentState && (order.status === 'PENDING' || order.status === 'PAID') && <section className="min-w-0 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-6">
        <h2 className="font-semibold">{stripe('paymentMethodStripe')}</h2>
        <p data-testid="stripe-payment-state" className="text-sm text-gray-700">{stripe(order.status === 'PAID' ? 'stateSucceeded' : paymentState === 'SUCCEEDED' ? 'stateReconciliation' : stripeStateKey[paymentState])}</p>
        <a href={'/' + locale + '/e/billing/' + encodeURIComponent(order.id)} className="inline-flex min-h-10 items-center text-sm text-blue-700 underline">{stripe('refreshStatus')}</a>
      </section>}
      {canContinueCheckout && <StripeCheckoutForm orderId={order.id} />}
      {showReceipt && receipt && <section data-testid="fpx-receipt" className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
        <h2 className="text-lg font-semibold">{stripe('receiptTitle')}</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-gray-600">{stripe('receiptDate')}</dt><dd className="mt-1 break-words"><time dateTime={receipt.createdAt}>{formatKLDateTime(receipt.createdAt, locale)}</time> (Asia/Kuala_Lumpur)</dd></div>
          <div className="min-w-0"><dt className="text-gray-600">{stripe('receiptAmount')}</dt><dd className="mt-1 font-semibold tabular-nums">{formatMoney(receipt.amountSen)}</dd></div>
          <div className="min-w-0"><dt className="text-gray-600">{stripe('receiptSellerOrderNo')}</dt><dd className="mt-1 break-words [overflow-wrap:anywhere]">{receipt.sellerOrderNo ?? stripe('notAvailable')}</dd></div>
          <div className="min-w-0"><dt className="text-gray-600">{stripe('receiptTransactionId')}</dt><dd className="mt-1 break-words [overflow-wrap:anywhere]">{receipt.transactionId ?? stripe('notAvailable')}</dd></div>
          <div className="min-w-0"><dt className="text-gray-600">{stripe('receiptBank')}</dt><dd className="mt-1 break-words [overflow-wrap:anywhere]">{receipt.bankName ?? stripe('notAvailable')}</dd></div>
          <div className="min-w-0"><dt className="text-gray-600">{stripe('receiptStatus')}</dt><dd className="mt-1 font-semibold">{stripe('receiptSucceeded')}</dd></div>
        </dl>
      </section>}
      {needsProof && <>
        <BankDetails bank={order.bankTransfer} historical orderNo={order.orderNo} />
        <PaymentProofForm orderId={order.id} hasProof={order.hasProof} />
      </>}
      {canUseBankActions && order.status === 'PENDING' && !order.hasProof && <CancelOrderDialog orderId={order.id} orderNo={order.orderNo} />}
    </AdminActionFeedback>
  </div>
}
