import 'server-only'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type Stripe from 'stripe'
import { Prisma, type Order, type StripeCheckoutAttempt } from '@prisma/client'
import { env } from '@/env'
import type { CompanyCtx } from '../authz'
import { db } from '../db'
import { AppError, ConflictError, FeatureDisabledError, ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { logger } from '../lib/logger'
import { createStripePaymentProvider } from '../payments/stripe'
import type { CheckoutObservation, PaymentProvider, TrustedCheckoutRequest } from '../payments/types'
import { commercialSnapshotSchema, readStripeAttemptSnapshot, settleStripeOrder } from './billing'
import { getSetting } from './settings'

export const startStripeCheckoutSchema = z.object({
  orderId: z.string().trim().min(1).max(200),
  locale: z.enum(['zh', 'en']),
}).strict()

export type StartStripeCheckoutInput = z.infer<typeof startStripeCheckoutSchema>
export interface StripeCheckoutResult {
  orderId: string
  checkoutUrl: string
}

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 }
const CREATE_RECOVERY_MS = 23 * 3600_000
const id = z.string().min(1).max(255)
const checkoutObservationSchema = z.object({
  sessionId: id.regex(/^cs_[a-zA-Z0-9_]+$/), url: z.string().nullable(), mode: z.literal('payment'),
  status: z.enum(['open', 'complete', 'expired']).nullable(),
  paymentStatus: z.enum(['paid', 'unpaid', 'no_payment_required']),
  amountTotalSen: z.number().int().positive().max(2_147_483_647), currency: z.string(),
  clientReferenceId: id, orderId: id, companyId: id,
  paymentIntentId: id.regex(/^pi_[a-zA-Z0-9_]+$/).nullable(), livemode: z.boolean(),
})

function unavailable(): AppError {
  return new AppError('Payment temporarily unavailable', 'PAYMENT_UNAVAILABLE', 503)
}
function rejected(): AppError {
  return new AppError('Payment facts rejected', 'PAYMENT_REJECTED', 400)
}
function paymentError(error: unknown): AppError {
  if (error instanceof AppError && error.code === 'PAYMENT_REJECTED') return rejected()
  if (error instanceof ForbiddenError || error instanceof NotFoundError || error instanceof FeatureDisabledError
    || error instanceof ValidationError || error instanceof ConflictError) return error
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target
    if (Array.isArray(target) && target.some(key => ['sessionId', 'paymentIntentId', 'externalRef'].includes(String(key)))) {
      return rejected()
    }
  }
  return unavailable()
}
function configuredMode(): 'test' | 'live' {
  const mode = env.STRIPE_MODE ?? 'test'
  if (mode !== 'test' && mode !== 'live') throw unavailable()
  return mode
}
async function assertOwner(ctx: CompanyCtx, tx: Prisma.TransactionClient = db): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { role: true, status: true } })
  if (!user || user.role !== 'EMPLOYER' || user.status !== 'ACTIVE') throw new ForbiddenError()
  const member = await tx.companyMember.findUnique({
    where: { companyId_userId: { companyId: ctx.companyId, userId: ctx.userId } },
    include: { company: { select: { isActive: true } } },
  })
  if (!member || member.role !== 'OWNER' || !member.company.isActive) throw new ForbiddenError()
}
function assertStartable(order: Order, attempt: StripeCheckoutAttempt | null): void {
  if (order.paymentProvider !== 'STRIPE' || order.status !== 'PENDING') {
    throw new ConflictError('Order cannot start Checkout')
  }
  if (attempt && ['FAILED', 'EXPIRED', 'SUCCEEDED'].includes(attempt.state)) {
    throw new ConflictError('Checkout cannot be reopened')
  }
}
function frozenRequest(order: Order, locale: 'zh' | 'en', idempotencyKey: string): TrustedCheckoutRequest {
  const parsed = commercialSnapshotSchema.safeParse(order.commercialSnapshot)
  if (!parsed.success) throw rejected()
  const snapshot = parsed.data
  if (snapshot.plan.id !== order.planId || snapshot.plan.kind !== order.kind
    || snapshot.money.currency !== order.currency || snapshot.money.payableSen !== order.amountSen
    || snapshot.money.discountSen !== order.discountSen) throw rejected()
  let base: URL
  try { base = new URL(env.APP_URL) } catch { throw unavailable() }
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password
    || base.search || base.hash || base.pathname !== '/') throw unavailable()
  const target = base.origin + '/' + locale + '/e/billing/' + encodeURIComponent(order.id)
  return {
    orderId: order.id, companyId: order.companyId, amountSen: order.amountSen, currency: 'MYR',
    productName: locale === 'zh' ? snapshot.plan.nameZh : snapshot.plan.nameEn,
    successUrl: target + '?checkout=success', cancelUrl: target + '?checkout=cancel', idempotencyKey,
  }
}
function outsideRecoveryWindow(attempt: StripeCheckoutAttempt): boolean {
  const age = Date.now() - attempt.requestedAt.getTime()
  return !Number.isFinite(age) || age < 0 || age >= CREATE_RECOVERY_MS
}
function hostedUrl(value: string | null): string {
  if (!value) throw unavailable()
  let url: URL
  try { url = new URL(value) } catch { throw rejected() }
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com'
    || url.username || url.password || url.port) throw rejected()
  return value
}
function verifyCheckout(
  value: CheckoutObservation, order: Order, attempt: StripeCheckoutAttempt, mode: 'test' | 'live',
): CheckoutObservation {
  const parsed = checkoutObservationSchema.safeParse(value)
  if (!parsed.success) throw rejected()
  const observed = parsed.data
  readStripeAttemptSnapshot(order, attempt, mode)
  if ((attempt.sessionId !== null && observed.sessionId !== attempt.sessionId)
    || observed.livemode !== (mode === 'live') || observed.amountTotalSen !== order.amountSen
    || observed.currency.toLowerCase() !== 'myr' || observed.orderId !== order.id
    || observed.companyId !== order.companyId || observed.clientReferenceId !== order.id
    || (attempt.paymentIntentId !== null && observed.paymentIntentId !== null
      && observed.paymentIntentId !== attempt.paymentIntentId)
    || observed.paymentStatus === 'no_payment_required') throw rejected()
  if (observed.url !== null) hostedUrl(observed.url)
  return observed
}

async function reserveCheckout(ctx: CompanyCtx, input: StartStripeCheckoutInput, mode: 'test' | 'live') {
  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, ctx.companyId)
    await assertOwner(ctx, tx)
    const order = await tx.order.findFirst({ where: { id: input.orderId, companyId: ctx.companyId } })
    if (!order) throw new NotFoundError('Order not found')
    let attempt = await tx.stripeCheckoutAttempt.findUnique({ where: { orderId: order.id } })
    assertStartable(order, attempt)
    if (!attempt) {
      if (await getSetting<unknown>('billing.enabled', false, { tx, fresh: true }) !== true) {
        throw new FeatureDisabledError('New billing is disabled')
      }
      if (order.externalRef !== null) throw rejected()
      const idempotencyKey = 'stripe-checkout-' + randomUUID()
      const request = frozenRequest(order, input.locale, idempotencyKey)
      attempt = await tx.stripeCheckoutAttempt.create({ data: {
        orderId: order.id, idempotencyKey, requestedAt: new Date(), state: 'CREATING',
        requestSnapshot: { version: 1, locale: input.locale, mode, request: { ...request } },
      } })
    }
    const frozen = readStripeAttemptSnapshot(order, attempt, mode)
    const reconcile = attempt.sessionId === null
      && (attempt.state === 'RECONCILIATION_REQUIRED' || outsideRecoveryWindow(attempt))
    if (reconcile && attempt.state !== 'RECONCILIATION_REQUIRED') {
      attempt = await tx.stripeCheckoutAttempt.update({
        where: { id: attempt.id }, data: { state: 'RECONCILIATION_REQUIRED' },
      })
    }
    return { order, attempt, frozen, reconcile }
  }, TRANSACTION_OPTIONS)
}

type ReservedCheckout = Awaited<ReturnType<typeof reserveCheckout>>

async function bindCheckout(
  ctx: CompanyCtx, reserved: ReservedCheckout, observed: CheckoutObservation, mode: 'test' | 'live',
): Promise<{ state: StripeCheckoutAttempt['state']; checkoutUrl: string | null }> {
  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, ctx.companyId)
    await assertOwner(ctx, tx)
    const order = await tx.order.findFirst({ where: { id: reserved.order.id, companyId: ctx.companyId } })
    if (!order) throw new NotFoundError('Order not found')
    const attempt = await tx.stripeCheckoutAttempt.findUnique({ where: { orderId: order.id } })
    assertStartable(order, attempt)
    if (!attempt || attempt.id !== reserved.attempt.id) throw rejected()
    const frozen = readStripeAttemptSnapshot(order, attempt, mode)
    if (!isDeepStrictEqual(frozen, reserved.frozen)) throw rejected()
    const verified = verifyCheckout(observed, order, attempt, mode)
    if (!verified.status) throw unavailable()
    if (verified.status === 'expired' && verified.paymentStatus !== 'unpaid') throw rejected()
    const state = attempt.state === 'PROCESSING' || verified.status === 'complete' || verified.paymentStatus === 'paid'
      ? 'PROCESSING' : verified.status === 'expired' ? 'EXPIRED' : 'OPEN'
    const checkoutUrl = state === 'OPEN' ? hostedUrl(verified.url) : null
    if (attempt.sessionId === null) {
      // Only this create/recovery result can establish the first Session binding.
      const bound = await tx.stripeCheckoutAttempt.updateMany({
        where: { id: attempt.id, orderId: order.id, sessionId: null, paymentIntentId: attempt.paymentIntentId },
        data: { sessionId: verified.sessionId, paymentIntentId: verified.paymentIntentId, state },
      })
      if (bound.count !== 1) throw unavailable()
      const attached = await tx.order.updateMany({
        where: { id: order.id, companyId: ctx.companyId, status: 'PENDING', paymentProvider: 'STRIPE', externalRef: null },
        data: { externalRef: verified.sessionId },
      })
      if (attached.count !== 1) throw unavailable()
    } else if (attempt.state !== state) {
      const updated = await tx.stripeCheckoutAttempt.updateMany({
        where: { id: attempt.id, orderId: order.id, sessionId: verified.sessionId, state: attempt.state },
        data: { state },
      })
      if (updated.count !== 1) throw unavailable()
    }
    return { state, checkoutUrl }
  }, TRANSACTION_OPTIONS)
}

export async function startStripeCheckout(
  ctx: CompanyCtx,
  input: StartStripeCheckoutInput,
): Promise<StripeCheckoutResult> {
  try {
    await assertOwner(ctx)
    const parsed = startStripeCheckoutSchema.safeParse(input)
    if (!parsed.success) throw new ValidationError('Invalid Checkout input')
    const mode = configuredMode()
    const reserved = await reserveCheckout(ctx, parsed.data, mode)
    if (reserved.reconcile) {
      // Throw after the transaction commits, so the reconciliation flag survives.
      logger.error({ orderId: reserved.order.id, attemptId: reserved.attempt.id }, 'Payment requires reconciliation')
      throw unavailable()
    }
    const provider: PaymentProvider = createStripePaymentProvider({ secretKey: env.STRIPE_SECRET_KEY, mode })
    const observed = reserved.attempt.sessionId === null
      ? await provider.createCheckout(reserved.frozen.request)
      : await provider.retrieveCheckout(reserved.attempt.sessionId)
    verifyCheckout(observed, reserved.order, reserved.attempt, mode)
    const bound = await bindCheckout(ctx, reserved, observed, mode)
    if (bound.state !== 'OPEN' || !bound.checkoutUrl) throw new ConflictError('Checkout is no longer open')
    return { orderId: reserved.order.id, checkoutUrl: bound.checkoutUrl }
  } catch (error) {
    throw paymentError(error)
  }
}

const eventTypeSchema = z.enum([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired',
])
const signedCheckoutEventSchema = z.object({
  id: id.regex(/^evt_[a-zA-Z0-9_]+$/), object: z.literal('event'), type: eventTypeSchema,
  api_version: z.literal('2026-10-28.endive'), livemode: z.boolean(),
  account: z.null().optional(), context: z.null().optional(),
  data: z.object({ object: z.object({
    id: id.regex(/^cs_[a-zA-Z0-9_]+$/), object: z.literal('checkout.session'), mode: z.literal('payment'),
    status: z.enum(['open', 'complete', 'expired']).nullable(),
    payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
    amount_total: z.number().int().positive().max(2_147_483_647), currency: z.string(),
    client_reference_id: id, metadata: z.object({ orderId: id, companyId: id }),
    payment_intent: z.union([
      id.regex(/^pi_[a-zA-Z0-9_]+$/),
      z.object({ object: z.literal('payment_intent'), id: id.regex(/^pi_[a-zA-Z0-9_]+$/) }),
    ]).nullable(),
    livemode: z.boolean(),
  }) }),
})
type SignedCheckoutEvent = z.infer<typeof signedCheckoutEventSchema>

function checkoutFromEvent(event: SignedCheckoutEvent): CheckoutObservation {
  const session = event.data.object
  return {
    sessionId: session.id, url: null, mode: session.mode, status: session.status,
    paymentStatus: session.payment_status, amountTotalSen: session.amount_total, currency: session.currency,
    clientReferenceId: session.client_reference_id,
    orderId: session.metadata.orderId, companyId: session.metadata.companyId,
    paymentIntentId: typeof session.payment_intent === 'string'
      ? session.payment_intent : session.payment_intent?.id ?? null,
    livemode: session.livemode,
  }
}
function assertPaymentOrder(order: Order): void {
  if (order.paymentProvider !== 'STRIPE' || !['PENDING', 'PAID'].includes(order.status)) throw rejected()
}
async function loadEventBinding(
  tx: Prisma.TransactionClient, orderId: string, companyId: string, attemptId: string,
): Promise<{ order: Order; attempt: StripeCheckoutAttempt }> {
  const order = await tx.order.findUnique({ where: { id: orderId } })
  const attempt = await tx.stripeCheckoutAttempt.findUnique({ where: { orderId } })
  if (!order || order.companyId !== companyId || !attempt || attempt.id !== attemptId) throw rejected()
  assertPaymentOrder(order)
  return { order, attempt }
}

/** Recover only a previously reserved create; event metadata never establishes a Session. */
async function recoverEventBinding(
  initial: { order: Order; attempt: StripeCheckoutAttempt }, incoming: CheckoutObservation,
  provider: PaymentProvider, mode: 'test' | 'live',
): Promise<{ order: Order; attempt: StripeCheckoutAttempt }> {
  const reserved = await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, initial.order.companyId)
    const current = await loadEventBinding(tx, initial.order.id, initial.order.companyId, initial.attempt.id)
    const frozen = readStripeAttemptSnapshot(current.order, current.attempt, mode)
    verifyCheckout(incoming, current.order, current.attempt, mode)
    if (current.attempt.sessionId !== null) return { ...current, frozen, reconcile: false }
    if (current.order.status !== 'PENDING') throw rejected()
    const reconcile = current.attempt.state === 'RECONCILIATION_REQUIRED'
      || ['FAILED', 'EXPIRED', 'SUCCEEDED'].includes(current.attempt.state)
      || outsideRecoveryWindow(current.attempt)
    if (reconcile && !['FAILED', 'EXPIRED', 'SUCCEEDED', 'RECONCILIATION_REQUIRED'].includes(current.attempt.state)) {
      await tx.stripeCheckoutAttempt.update({
        where: { id: current.attempt.id }, data: { state: 'RECONCILIATION_REQUIRED' },
      })
    }
    return { ...current, frozen, reconcile }
  }, TRANSACTION_OPTIONS)
  if (reserved.reconcile) {
    logger.error({ orderId: reserved.order.id, attemptId: reserved.attempt.id }, 'Payment requires reconciliation')
    throw unavailable()
  }
  if (reserved.attempt.sessionId !== null) return reserved
  const created = await provider.createCheckout(reserved.frozen.request)
  const verified = verifyCheckout(created, reserved.order, reserved.attempt, mode)
  if (verified.sessionId !== incoming.sessionId || verified.status !== 'open') throw rejected()
  return db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, reserved.order.companyId)
    const current = await loadEventBinding(tx, reserved.order.id, reserved.order.companyId, reserved.attempt.id)
    const frozen = readStripeAttemptSnapshot(current.order, current.attempt, mode)
    if (!isDeepStrictEqual(frozen, reserved.frozen)) throw rejected()
    verifyCheckout(verified, current.order, current.attempt, mode)
    verifyCheckout(incoming, current.order, current.attempt, mode)
    if (current.attempt.sessionId === null) {
      if (current.order.status !== 'PENDING') throw rejected()
      const updated = await tx.stripeCheckoutAttempt.updateMany({
        where: {
          id: current.attempt.id, orderId: current.order.id, sessionId: null,
          paymentIntentId: current.attempt.paymentIntentId,
        },
        data: {
          sessionId: verified.sessionId, paymentIntentId: verified.paymentIntentId,
          state: current.attempt.state === 'PROCESSING' ? 'PROCESSING' : 'OPEN',
        },
      })
      if (updated.count !== 1) throw unavailable()
      const attached = await tx.order.updateMany({
        where: {
          id: current.order.id, companyId: current.order.companyId,
          paymentProvider: 'STRIPE', status: 'PENDING', externalRef: null,
        },
        data: { externalRef: verified.sessionId },
      })
      if (attached.count !== 1) throw unavailable()
      return loadEventBinding(tx, current.order.id, current.order.companyId, current.attempt.id)
    }
    return current
  }, TRANSACTION_OPTIONS)
}

async function recordUnpaidEvent(
  binding: { order: Order; attempt: StripeCheckoutAttempt }, incoming: CheckoutObservation,
  type: SignedCheckoutEvent['type'], mode: 'test' | 'live',
): Promise<void> {
  await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, binding.order.companyId)
    const current = await loadEventBinding(tx, binding.order.id, binding.order.companyId, binding.attempt.id)
    verifyCheckout(incoming, current.order, current.attempt, mode)
    if (current.attempt.sessionId === null) throw unavailable()
    if (current.order.status === 'PAID' || current.attempt.state === 'SUCCEEDED') return
    // Late pending/failure notifications cannot reopen an already terminal attempt.
    if (['FAILED', 'EXPIRED'].includes(current.attempt.state)) return
    const state = type === 'checkout.session.expired' ? 'EXPIRED'
      : type === 'checkout.session.async_payment_failed' ? 'FAILED' : 'PROCESSING'
    if (current.attempt.state !== state) {
      const updated = await tx.stripeCheckoutAttempt.updateMany({
        where: {
          id: current.attempt.id, orderId: current.order.id,
          sessionId: current.attempt.sessionId, state: current.attempt.state,
        },
        data: { state },
      })
      if (updated.count !== 1) throw unavailable()
    }
  }, TRANSACTION_OPTIONS)
}

/** Internal route seam only; never register this as a public action. */
export async function handleStripeWebhook(event: Stripe.Event): Promise<void> {
  let knownOrderId: string | undefined
  let knownAttemptId: string | undefined
  const rawType = typeof event === 'object' && event !== null ? event.type : undefined
  const supported = eventTypeSchema.safeParse(rawType)
  if (!supported.success) {
    if (typeof rawType === 'string') return
    throw rejected()
  }
  try {
    const parsed = signedCheckoutEventSchema.safeParse(event)
    if (!parsed.success) throw rejected()
    const signed = parsed.data
    const mode = configuredMode()
    if (signed.livemode !== (mode === 'live')) throw rejected()
    const incoming = checkoutFromEvent(signed)
    const expectedStatus = signed.type === 'checkout.session.expired' ? 'expired' : 'complete'
    if (incoming.status !== expectedStatus) throw rejected()
    const order = await db.order.findUnique({ where: { id: signed.data.object.metadata.orderId } })
    if (!order) throw rejected()
    knownOrderId = order.id
    if (order.companyId !== signed.data.object.metadata.companyId) throw rejected()
    assertPaymentOrder(order)
    const attempt = await db.stripeCheckoutAttempt.findUnique({ where: { orderId: order.id } })
    if (!attempt) throw rejected()
    knownAttemptId = attempt.id
    verifyCheckout(incoming, order, attempt, mode)
    const provider = createStripePaymentProvider({ secretKey: env.STRIPE_SECRET_KEY, mode })
    const binding = attempt.sessionId === null
      ? await recoverEventBinding({ order, attempt }, incoming, provider, mode)
      : { order, attempt }
    verifyCheckout(incoming, binding.order, binding.attempt, mode)
    if (signed.type === 'checkout.session.expired' || signed.type === 'checkout.session.async_payment_failed') {
      if (incoming.paymentStatus !== 'unpaid') throw rejected()
      await recordUnpaidEvent(binding, incoming, signed.type, mode)
      return
    }
    if (signed.type === 'checkout.session.completed' && incoming.paymentStatus === 'unpaid') {
      await recordUnpaidEvent(binding, incoming, signed.type, mode)
      return
    }
    if (incoming.paymentStatus !== 'paid' || binding.attempt.sessionId === null) throw unavailable()
    // Recovery can return the cached open create response. Always read current payment facts.
    const observed = await provider.retrieveCheckout(binding.attempt.sessionId)
    const checkout = verifyCheckout(observed, binding.order, binding.attempt, mode)
    if (checkout.paymentStatus !== 'paid' || checkout.paymentIntentId === null) throw unavailable()
    if (incoming.paymentIntentId !== null && incoming.paymentIntentId !== checkout.paymentIntentId) throw rejected()
    const payment = await provider.retrievePayment(checkout.paymentIntentId)
    await settleStripeOrder({
      orderId: binding.order.id, companyId: binding.order.companyId, attemptId: binding.attempt.id,
      event: { id: signed.id, type: signed.type, livemode: signed.livemode }, checkout, payment,
    })
  } catch (error) {
    const safe = paymentError(error)
    if (safe.httpStatus === 400) logger.error({
      eventType: supported.data, ...(knownOrderId ? { orderId: knownOrderId } : {}),
      ...(knownAttemptId ? { attemptId: knownAttemptId } : {}),
    }, 'Stripe payment rejected')
    throw safe
  }
}
