/** T03 contract types only. No Stripe SDK, environment, database, or runtime imports. */
export interface TrustedCheckoutRequest {
  readonly orderId: string
  readonly companyId: string
  readonly amountSen: number
  readonly currency: 'MYR'
  readonly productName: string
  readonly successUrl: string
  readonly cancelUrl: string
  readonly idempotencyKey: string
}

export interface CheckoutObservation {
  sessionId: string
  url: string | null
  mode: 'payment'
  status: 'open' | 'complete' | 'expired' | null
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required'
  amountTotalSen: number | null
  currency: string | null
  clientReferenceId: string | null
  orderId: string | null
  companyId: string | null
  paymentIntentId: string | null
  livemode: boolean
}

export interface CreatedCheckout extends CheckoutObservation {
  url: string
  status: 'open'
  amountTotalSen: number
  currency: 'myr'
}

export interface ChargeObservation {
  chargeId: string
  paymentIntentId: string | null
  createdAt: string
  statementDescriptor: string | null
  fpx: { transactionId: string | null; bankCode: string } | null
  status: 'succeeded' | 'pending' | 'failed'
  paid: boolean
  amountSen: number
  currency: string
  livemode: boolean
  refunded: boolean
  amountRefundedSen: number
  paymentMethod: 'card' | 'fpx' | null
}

export interface PaymentObservation {
  paymentIntentId: string
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action'
    | 'processing' | 'requires_capture' | 'canceled' | 'succeeded'
  amountSen: number
  amountReceivedSen: number
  currency: string
  orderId: string | null
  companyId: string | null
  livemode: boolean
  latestCharge: ChargeObservation | null
}

export interface PaymentProvider {
  createCheckout(input: TrustedCheckoutRequest): Promise<CreatedCheckout>
  retrieveCheckout(sessionId: string): Promise<CheckoutObservation>
  expireCheckout(sessionId: string): Promise<CheckoutObservation>
  retrievePayment(paymentIntentId: string): Promise<PaymentObservation>
}

export interface FpxReceiptSnapshotV1 {
  version: 1
  createdAt: string
  amountSen: number
  currency: 'MYR'
  orderNo: string
  sellerOrderNo: string | null
  transactionId: string | null
  bankCode: string
  status: 'succeeded'
}

export interface FpxReceipt {
  createdAt: string
  amountSen: number
  currency: 'MYR'
  orderNo: string
  sellerOrderNo: string | null
  transactionId: string | null
  bankName: string | null
  status: 'succeeded'
}

export type StripePaymentViewState =
  | 'NOT_STARTED' | 'CREATING' | 'OPEN' | 'PROCESSING' | 'SUCCEEDED'
  | 'FAILED' | 'EXPIRED' | 'RECONCILIATION_REQUIRED'

export interface StripePaymentView {
  state: StripePaymentViewState
  fpxReceipt: FpxReceipt | null
}
