import 'server-only'
import Stripe from 'stripe'
import { z } from 'zod'
import { AppError } from '../errors'
import type { CheckoutObservation, ChargeObservation, PaymentProvider, TrustedCheckoutRequest } from './types'

export interface StripeProviderConfig {
  secretKey?: string
  mode?: 'test' | 'live'
}

function rejected(): AppError {
  return new AppError('Payment provider response rejected', 'PAYMENT_REJECTED', 400)
}

function unavailable(): AppError {
  return new AppError('Payment provider unavailable', 'PAYMENT_UNAVAILABLE', 503)
}

const id = (prefix: string) => z.string().max(255).regex(new RegExp('^' + prefix + '[a-zA-Z0-9_]+$'))
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const receiptText = z.string().min(1).max(128).refine(value =>
  Array.from(value).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127))
const metadata = z.object({
  orderId: z.string().min(1).max(200).optional(),
  companyId: z.string().min(1).max(200).optional(),
}).nullable()
const paymentRef = z.union([
  id('pi_'), z.object({ object: z.literal('payment_intent'), id: id('pi_') }),
]).nullable()
const sessionSchema = z.object({
  object: z.literal('checkout.session'), id: id('cs_'), url: z.string().nullable(),
  mode: z.literal('payment'), status: z.enum(['open', 'complete', 'expired']).nullable(),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  amount_total: money.nullable(), currency: z.string().nullable(),
  client_reference_id: z.string().nullable(), metadata,
  payment_intent: paymentRef, livemode: z.boolean(),
})
const chargeSchema = z.object({
  object: z.literal('charge'), id: id('ch_'), payment_intent: paymentRef,
  created: z.number().int().nonnegative(), statement_descriptor: receiptText.nullable(),
  status: z.enum(['succeeded', 'pending', 'failed']), paid: z.boolean(), amount: money,
  currency: z.string(), livemode: z.boolean(), refunded: z.boolean(), amount_refunded: money,
  payment_method_details: z.object({
    type: z.string(),
    fpx: z.object({
      bank: receiptText,
      transaction_id: receiptText.nullable(),
    }).optional(),
  }).refine(details => details.type !== 'fpx' || details.fpx !== undefined).nullable(),
})
const paymentSchema = z.object({
  object: z.literal('payment_intent'), id: id('pi_'),
  status: z.enum(['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded']),
  amount: money, amount_received: money, currency: z.string(), metadata,
  livemode: z.boolean(), latest_charge: z.union([id('ch_'), chargeSchema]).nullable(),
})

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw rejected()
  return result.data
}

function reference(value: z.infer<typeof paymentRef>): string | null {
  return typeof value === 'string' ? value : value?.id ?? null
}

function hostedUrl(value: string | null): string {
  if (!value) throw rejected()
  let url: URL
  try { url = new URL(value) } catch { throw rejected() }
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com'
    || url.username || url.password || url.port) throw rejected()
  return value
}

function checkout(value: unknown, live: boolean, expectedId?: string): CheckoutObservation {
  const session = parse(sessionSchema, value)
  if (session.livemode !== live || (expectedId && session.id !== expectedId)) throw rejected()
  return {
    sessionId: session.id, url: session.url === null ? null : hostedUrl(session.url),
    mode: session.mode, status: session.status, paymentStatus: session.payment_status,
    amountTotalSen: session.amount_total, currency: session.currency,
    clientReferenceId: session.client_reference_id,
    orderId: session.metadata?.orderId ?? null, companyId: session.metadata?.companyId ?? null,
    paymentIntentId: reference(session.payment_intent), livemode: session.livemode,
  }
}

function charge(value: unknown, live: boolean, chargeId: string, paymentId: string): ChargeObservation {
  const result = parse(chargeSchema, value)
  if (result.livemode !== live || result.id !== chargeId || reference(result.payment_intent) !== paymentId) throw rejected()
  const createdMs = result.created * 1000
  if (!Number.isSafeInteger(createdMs)) throw rejected()
  const createdAt = new Date(createdMs)
  if (!Number.isFinite(createdAt.getTime())) throw rejected()
  const details = result.payment_method_details
  const method = details?.type === 'card' || details?.type === 'fpx' ? details.type : null
  return {
    chargeId: result.id, paymentIntentId: paymentId, createdAt: createdAt.toISOString(),
    statementDescriptor: result.statement_descriptor,
    fpx: method === 'fpx' && details?.fpx ? {
      bankCode: details.fpx.bank, transactionId: details.fpx.transaction_id,
    } : null,
    status: result.status, paid: result.paid, amountSen: result.amount,
    currency: result.currency, livemode: result.livemode, refunded: result.refunded,
    amountRefundedSen: result.amount_refunded, paymentMethod: method,
  }
}

function assertRequest(input: TrustedCheckoutRequest): void {
  if (!Number.isSafeInteger(input.amountSen) || input.amountSen <= 0 || input.currency !== 'MYR'
    || !input.orderId || !input.companyId || !input.idempotencyKey || !input.productName) throw rejected()
}

export function createStripePaymentProvider(config: StripeProviderConfig): PaymentProvider {
  let instance: Stripe | undefined
  const mode = config.mode ?? 'test'
  const live = mode === 'live'
  function client(): Stripe {
    if (!config.secretKey || !new RegExp(`^(sk|rk)_${mode}_.+$`).test(config.secretKey)) throw unavailable()
    instance ??= new Stripe(config.secretKey, {
      apiVersion: '2026-10-28.endive', timeout: 10_000, maxNetworkRetries: 0,
    })
    return instance
  }
  async function safe<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      if (error instanceof AppError && error.code === 'PAYMENT_REJECTED') throw rejected()
      const type = typeof error === 'object' && error !== null && 'type' in error ? error.type : null
      if (type === 'StripeInvalidRequestError' || type === 'StripeIdempotencyError') throw rejected()
      // Never preserve SDK message/cause/raw/stack: they can contain payment secrets.
      throw unavailable()
    }
  }
  return {
    createCheckout: input => safe(async () => {
      assertRequest(input)
      const metadata = { orderId: input.orderId, companyId: input.companyId }
      const response = await client().checkout.sessions.create({
        mode: 'payment', ui_mode: 'hosted_page', allowed_payment_method_types: ['card', 'fpx'],
        client_reference_id: input.orderId, metadata, payment_intent_data: { metadata },
        line_items: [{ price_data: {
          currency: 'myr', unit_amount: input.amountSen, product_data: { name: input.productName },
        }, quantity: 1 }],
        success_url: input.successUrl, cancel_url: input.cancelUrl,
      }, { idempotencyKey: input.idempotencyKey })
      const result = checkout(response, live)
      if (result.status !== 'open' || result.amountTotalSen !== input.amountSen || result.currency !== 'myr'
        || result.clientReferenceId !== input.orderId || result.orderId !== input.orderId
        || result.companyId !== input.companyId) throw rejected()
      return { ...result, url: hostedUrl(result.url), status: 'open', amountTotalSen: input.amountSen, currency: 'myr' }
    }),
    retrieveCheckout: sessionId => safe(async () => {
      parse(id('cs_'), sessionId)
      return checkout(await client().checkout.sessions.retrieve(sessionId), live, sessionId)
    }),
    expireCheckout: sessionId => safe(async () => {
      parse(id('cs_'), sessionId)
      return checkout(await client().checkout.sessions.expire(sessionId), live, sessionId)
    }),
    retrievePayment: paymentIntentId => safe(async () => {
      parse(id('pi_'), paymentIntentId)
      const observed = parse(paymentSchema, await client().paymentIntents.retrieve(paymentIntentId))
      if (observed.id !== paymentIntentId || observed.livemode !== live) throw rejected()
      const latest = observed.latest_charge
      const latestCharge = latest === null ? null : typeof latest === 'string'
        ? charge(await client().charges.retrieve(latest), live, latest, paymentIntentId)
        : charge(latest, live, latest.id, paymentIntentId)
      return {
        paymentIntentId: observed.id, status: observed.status,
        amountSen: observed.amount, amountReceivedSen: observed.amount_received,
        currency: observed.currency, orderId: observed.metadata?.orderId ?? null,
        companyId: observed.metadata?.companyId ?? null, livemode: observed.livemode, latestCharge,
      }
    }),
  }
}
