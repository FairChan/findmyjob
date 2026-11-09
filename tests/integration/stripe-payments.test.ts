/**
 * M8-T03 service integration contract.
 * Real T02 quote/order/ledger/audit transactions; external provider fully mocked.
 * Requires the reviewed T03 attempt schema and internal settlement integration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import type Stripe from 'stripe'
import type {
  CheckoutObservation, CreatedCheckout, PaymentObservation, TrustedCheckoutRequest,
} from '@/server/payments/types'

const testKeys = vi.hoisted(() => ({ api: crypto.randomUUID(), hook: crypto.randomUUID() }))
const mocks = vi.hoisted(() => ({
  create: vi.fn(), retrieve: vi.fn(), expire: vi.fn(), retrievePayment: vi.fn(),
  notify: vi.fn(), alert: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  failBinding: false, failAudit: false, failReceipt: false,
  scope: null as import('node:async_hooks').AsyncLocalStorage<boolean> | null,
  http: [] as Array<{ operation: string; inTransaction: boolean; lockFree: boolean; attemptCommitted: boolean }>,
  env: {
    APP_URL: 'https://payments.example.test',
    APP_ENV: 'test',
    STRIPE_MODE: 'test',
    STRIPE_SECRET_KEY: 'sk_test_' + testKeys.api,
    STRIPE_WEBHOOK_SECRET: testKeys.hook,
  },
}))
vi.mock('@/env', () => ({ env: mocks.env }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/lib/logger', () => ({ logger: mocks.logger }))
vi.mock('@/server/lib/alert', () => ({ alert: mocks.alert }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: mocks.notify }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: vi.fn() }))
vi.mock('@/server/payments/stripe', () => ({
  createStripePaymentProvider: vi.fn(() => ({
    createCheckout: mocks.create,
    retrieveCheckout: mocks.retrieve,
    expireCheckout: mocks.expire,
    retrievePayment: mocks.retrievePayment,
  })),
}))
vi.mock('@/server/db', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks')
  const { testDb } = await import('../setup/db')
  mocks.scope = new AsyncLocalStorage<boolean>()
  const extended = testDb.$extends({
    query: {
      stripeCheckoutAttempt: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args)
          const data = 'data' in args ? args.data : null
          const binding = data && typeof data === 'object' && 'sessionId' in data && data.sessionId
          if (mocks.failBinding && ['update', 'updateMany'].includes(operation) && binding) {
            throw new Error('SYNTHETIC_PRIVATE_PAYMENT bind write failed after query')
          }
          const receipt = data && typeof data === 'object' && 'fpxReceipt' in data && data.fpxReceipt
          if (mocks.failReceipt && ['update', 'updateMany'].includes(operation) && receipt) {
            throw new Error('SYNTHETIC_PRIVATE_PAYMENT receipt write failed after query')
          }
          return result
        },
      },
      auditLog: {
        async create({ args, query }) {
          const result = await query(args)
          if (mocks.failAudit && args.data.action === 'order.confirm') {
            throw new Error('SYNTHETIC_PRIVATE_PAYMENT audit failed after insert')
          }
          return result
        },
      },
    },
  })
  // Preserve actual Prisma operations; observe transaction context only.
  const db = new Proxy(extended, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (property !== '$transaction') return typeof value === 'function' ? value.bind(target) : value
      return (first: unknown, ...rest: unknown[]) => {
        if (typeof first !== 'function') return Reflect.apply(value, target, [first, ...rest])
        const callback = first as (tx: Prisma.TransactionClient) => Promise<unknown>
        return Reflect.apply(value, target, [
          (tx: Prisma.TransactionClient) => mocks.scope!.run(true, () => callback(tx)), ...rest,
        ])
      }
    },
  })
  return { db }
})

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { billingFixture, foundingOffer, pendingOrder, setting, type BillingFixture } from '../helpers/billing-t02'
import { createOrder, quoteOrder, getMyOrder, confirmBankOrder } from '@/server/services/billing'
import { startStripeCheckout, handleStripeWebhook } from '@/server/services/stripe-payments'
import { LOCK_NS, lockXact } from '@/server/lib/advisory-locks'

const PRIVATE = 'SYNTHETIC_PRIVATE_PAYMENT'
const sessions = new Map<string, CheckoutObservation>()
const payments = new Map<string, PaymentObservation>()
const keys = new Map<string, string>()
const initialResponses = new Map<string, CreatedCheckout>()
let nextSession = 0

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function text(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => item instanceof Error
    ? Object.fromEntries(Object.getOwnPropertyNames(item).map((key) => [
      key, (item as unknown as Record<string, unknown>)[key],
    ]))
    : item)
}

function alerts() {
  return text([mocks.alert.mock.calls, ...Object.values(mocks.logger).map((mock) => mock.mock.calls)])
}

async function recordHttp(operation: string, orderId: string, companyId: string) {
  const attempt = await testDb.stripeCheckoutAttempt.findUnique({ where: { orderId } })
  const lockFree = await testDb.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_xact_lock(${LOCK_NS.CREDIT}::int, hashtext(${companyId})::int) AS acquired
    `)
    return row.acquired
  })
  mocks.http.push({
    operation, inTransaction: mocks.scope?.getStore() === true,
    lockFree, attemptCommitted: attempt !== null,
  })
}

function newSession(request: TrustedCheckoutRequest): CreatedCheckout {
  const sessionId = 'cs_test_service_' + ++nextSession
  const paymentIntentId = 'pi_service_' + nextSession
  const created: CreatedCheckout = {
    sessionId,
    url: 'https://checkout.stripe.com/c/pay/' + sessionId,
    mode: 'payment', status: 'open', paymentStatus: 'unpaid',
    amountTotalSen: request.amountSen, currency: 'myr',
    clientReferenceId: request.orderId, orderId: request.orderId, companyId: request.companyId,
    paymentIntentId, livemode: false,
  }
  payments.set(paymentIntentId, {
    paymentIntentId, status: 'succeeded',
    amountSen: request.amountSen, amountReceivedSen: request.amountSen, currency: 'myr',
    orderId: request.orderId, companyId: request.companyId, livemode: false,
    latestCharge: {
      chargeId: 'ch_service_' + nextSession, paymentIntentId,
      createdAt: new Date(1_794_268_800_000).toISOString(),
      statementDescriptor: 'SYNTHETIC SELLER ORDER', fpx: null,
      status: 'succeeded', paid: true, amountSen: request.amountSen,
      currency: 'myr', livemode: false, refunded: false, amountRefundedSen: 0,
      paymentMethod: 'card',
    },
  })
  sessions.set(sessionId, created)
  keys.set(request.idempotencyKey, sessionId)
  initialResponses.set(request.idempotencyKey, structuredClone(created))
  return structuredClone(created)
}

async function createExternal(request: TrustedCheckoutRequest): Promise<CreatedCheckout> {
  await recordHttp('create', request.orderId, request.companyId)
  const existing = keys.get(request.idempotencyKey)
  return existing ? structuredClone(initialResponses.get(request.idempotencyKey)!) : newSession(request)
}

async function retrieveExternal(sessionId: string): Promise<CheckoutObservation> {
  const observed = sessions.get(sessionId)
  if (!observed) throw new Error('Unknown synthetic Session')
  await recordHttp('retrieve', observed.orderId!, observed.companyId!)
  return structuredClone(observed)
}

async function retrievePaymentExternal(paymentIntentId: string): Promise<PaymentObservation> {
  const observed = payments.get(paymentIntentId)
  if (!observed) throw new Error('Unknown synthetic PaymentIntent')
  await recordHttp('retrievePayment', observed.orderId!, observed.companyId!)
  return structuredClone(observed)
}

async function stripeOrder(f: BillingFixture) {
  const acceptedQuote = await quoteOrder(f.ctx, { planId: f.plan.id })
  const result = await createOrder(f.ctx, { planId: f.plan.id, method: 'STRIPE', acceptedQuote })
  return testDb.order.findUniqueOrThrow({ where: { id: result.orderId } })
}

async function bound(kind: 'PLAN' | 'CREDIT_PACK' = 'PLAN') {
  const f = await billingFixture(kind)
  const order = await stripeOrder(f)
  await startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' })
  const attempt = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { orderId: order.id } })
  return { f, order, attempt }
}

function markPaid(sessionId: string, method: 'card' | 'fpx' = 'card') {
  const session = sessions.get(sessionId)!
  sessions.set(sessionId, { ...session, status: 'complete', paymentStatus: 'paid', url: null })
  const payment = payments.get(session.paymentIntentId!)!
  payments.set(payment.paymentIntentId, {
    ...payment, latestCharge: {
      ...payment.latestCharge!, paymentMethod: method,
      fpx: method === 'fpx' ? { bankCode: 'maybank2u', transactionId: 'SYNTHETIC_FPX_TX_001' } : null,
    },
  })
}

function event(sessionId: string, type = 'checkout.session.completed', id = 'evt_service_1'): Stripe.Event {
  const session = sessions.get(sessionId)!
  // Deliberately constructed wire Event: signature testing belongs to the route suite.
  return {
    id, object: 'event', type, api_version: '2026-10-28.endive', created: Math.floor(Date.now() / 1000),
    livemode: false, pending_webhooks: 1, request: null,
    data: { object: {
      object: 'checkout.session', id: sessionId, mode: session.mode, status: session.status,
      payment_status: session.paymentStatus, amount_total: session.amountTotalSen,
      currency: session.currency, client_reference_id: session.clientReferenceId,
      metadata: { orderId: session.orderId, companyId: session.companyId, privateExtra: PRIVATE },
      payment_intent: session.paymentIntentId, livemode: session.livemode,
    } },
  } as unknown as Stripe.Event
}

async function noDelivery(orderId: string, companyId: string) {
  expect(await testDb.creditLedger.count({ where: { refType: 'Order', refId: orderId } })).toBe(0)
  expect(await testDb.subscription.count({ where: { orderId } })).toBe(0)
  expect(await testDb.auditLog.count({ where: { action: 'order.confirm', targetId: orderId } })).toBe(0)
  expect(await testDb.creditWallet.findUnique({ where: { companyId } })).toBeNull()
  expect(mocks.notify).not.toHaveBeenCalled()
}

async function expectOneDelivery(orderId: string, companyId: string, credits = 120, subscriptions = 1) {
  expect(await testDb.creditLedger.findMany({ where: { refType: 'Order', refId: orderId } }))
    .toEqual([expect.objectContaining({ delta: credits, balanceAfter: credits })])
  expect(await testDb.creditWallet.findUnique({ where: { companyId } })).toMatchObject({ balance: credits })
  expect(await testDb.subscription.count({ where: { orderId } })).toBe(subscriptions)
  expect(await testDb.auditLog.count({ where: { action: 'order.confirm', targetId: orderId } })).toBe(1)
  expect(mocks.notify).toHaveBeenCalledOnce()
}

setupTestDb()
beforeEach(() => {
  vi.clearAllMocks()
  mocks.failBinding = false
  mocks.failAudit = false
  mocks.failReceipt = false
  mocks.http.length = 0
  mocks.env.APP_URL = 'https://payments.example.test'
  mocks.env.STRIPE_MODE = 'test'
  sessions.clear()
  payments.clear()
  keys.clear()
  initialResponses.clear()
  nextSession = 0
  mocks.create.mockReset().mockImplementation(createExternal)
  mocks.retrieve.mockReset().mockImplementation(retrieveExternal)
  mocks.retrievePayment.mockReset().mockImplementation(retrievePaymentExternal)
  mocks.expire.mockReset().mockImplementation(async (id: string) => {
    const observed = await retrieveExternal(id)
    const expired = { ...observed, status: 'expired' as const, url: null }
    sessions.set(id, expired)
    return expired
  })
  mocks.notify.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden') }))
})
afterEach(() => vi.unstubAllGlobals())

describe('M8-T03 persistent Checkout identity', () => {
  it('freezes the net quote, locale and local return URLs before HTTP without holding a transaction', async () => {
    const f = await billingFixture('PLAN', 299901)
    await foundingOffer(f)
    const order = await stripeOrder(f)
    const result = await startStripeCheckout(f.ctx, { orderId: order.id, locale: 'zh' })
    const attempt = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { orderId: order.id } })
    const request = mocks.create.mock.calls[0][0] as TrustedCheckoutRequest
    expect(request).toMatchObject({
      orderId: order.id, companyId: f.ctx.companyId, amountSen: 149951,
      currency: 'MYR', productName: f.plan.nameZh, idempotencyKey: attempt.idempotencyKey,
    })
    for (const value of [request.successUrl, request.cancelUrl]) {
      expect(new URL(value).origin).toBe('https://payments.example.test')
      expect(new URL(value).pathname).toBe('/zh/e/billing/' + order.id)
    }
    expect(attempt.requestSnapshot).toEqual({ version: 1, locale: 'zh', mode: 'test', request })
    expect(attempt).toMatchObject({ state: 'OPEN', sessionId: expect.any(String) })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({
      externalRef: attempt.sessionId, amountSen: 149951, paymentMethod: null, status: 'PENDING',
    })
    expect(result).toEqual({ orderId: order.id, checkoutUrl: sessions.get(attempt.sessionId!)!.url })
    expect(mocks.http).toEqual([{
      operation: 'create', inTransaction: false, lockFree: true, attemptCommitted: true,
    }])
    await noDelivery(order.id, f.ctx.companyId)
  })

  it('waits for company CREDIT before reserving the first attempt or calling provider', async () => {
    const f = await billingFixture()
    const order = await stripeOrder(f)
    const acquired = deferred()
    const release = deferred()
    const holder = testDb.$transaction(async (tx) => {
      await lockXact(tx, LOCK_NS.CREDIT, f.ctx.companyId)
      acquired.resolve()
      await release.promise
    }, { timeout: 15000 })
    let started: ReturnType<typeof startStripeCheckout> | undefined
    try {
      await Promise.race([acquired.promise, holder.then(() => { throw new Error('Holder ended before CREDIT') })])
      started = startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' })
      void started.catch(() => undefined)
      await expect.poll(async () => {
        const [row] = await testDb.$queryRaw<Array<{ waiting: number }>>(Prisma.sql`
          SELECT count(*)::int AS waiting FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND classid = ${LOCK_NS.CREDIT}::oid AND objid = hashtext(${f.ctx.companyId})::oid
        `)
        return row.waiting
      }, { timeout: 3000, interval: 20 }).toBeGreaterThan(0)
      expect(mocks.create).not.toHaveBeenCalled()
      expect(await testDb.stripeCheckoutAttempt.count()).toBe(0)
    } finally {
      release.resolve()
      await holder
      if (started) await started
    }
    expect(await testDb.stripeCheckoutAttempt.count()).toBe(1)
  })

  it('concurrent starts share one persistent attempt, key, parameters and external Session', async () => {
    const f = await billingFixture()
    const order = await stripeOrder(f)
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () =>
      startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' })))
    const attempts = await testDb.stripeCheckoutAttempt.findMany({ where: { orderId: order.id } })
    expect(attempts).toHaveLength(1)
    expect(keys.size).toBe(1)
    expect(sessions.size).toBe(1)
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled').length).toBeGreaterThan(0)
    for (const outcome of outcomes) {
      const status = outcome.status === 'rejected' ? outcome.reason.httpStatus : 200
      expect([200, 503]).toContain(status)
    }
    const requests = mocks.create.mock.calls.map(([request]) => request)
    expect(requests.length).toBeGreaterThan(0)
    expect(requests).toEqual(Array(requests.length).fill(requests[0]))
    expect(attempts[0].idempotencyKey).toBe(requests[0].idempotencyKey)
    await noDelivery(order.id, f.ctx.companyId)
  })

  it('recovers unknown create outcome with the original snapshot while sales and app config change', async () => {
    const f = await billingFixture()
    const order = await stripeOrder(f)
    mocks.create.mockImplementationOnce(async (request: TrustedCheckoutRequest) => {
      await createExternal(request)
      throw new Error(PRIVATE + ' timeout after remote success')
    })
    await expect(startStripeCheckout(f.ctx, { orderId: order.id, locale: 'zh' }))
      .rejects.toMatchObject({ httpStatus: 503 })
    await testDb.stripeCheckoutAttempt.update({
      where: { orderId: order.id }, data: { requestedAt: new Date(Date.now() - 3600_000) },
    })
    const original = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(original.sessionId).toBeNull()
    await setting('billing.enabled', false)
    await testDb.plan.update({ where: { id: f.plan.id }, data: { priceSen: 1, nameZh: 'Changed', isActive: false } })
    mocks.env.APP_URL = 'https://new-app.example.test'
    await startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' })
    const recovered = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0])
    expect(recovered).toMatchObject({
      id: original.id, idempotencyKey: original.idempotencyKey,
      requestSnapshot: original.requestSnapshot, requestedAt: original.requestedAt,
    })
    expect(recovered.sessionId).toBe([...sessions.keys()][0])
    expect(sessions.size).toBe(1)
    expect(alerts()).not.toContain(PRIVATE)
  })

  it('recovers a create result after the local binding write rolls back', async () => {
    const f = await billingFixture()
    const order = await stripeOrder(f)
    mocks.failBinding = true
    await expect(startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' }))
      .rejects.toMatchObject({ httpStatus: 503 })
    const unbound = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(unbound.sessionId).toBeNull()
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ externalRef: null })
    expect(sessions.size).toBe(1)
    mocks.failBinding = false
    await startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' })
    expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0])
    expect(await testDb.stripeCheckoutAttempt.findUnique({ where: { orderId: order.id } }))
      .toMatchObject({ id: unbound.id, sessionId: [...sessions.keys()][0] })
    expect(sessions.size).toBe(1)
  })

  it('blocks a historical order without an attempt when billing is closed', async () => {
    const f = await billingFixture()
    const order = await stripeOrder(f)
    await setting('billing.enabled', false)
    await expect(startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' }))
      .rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    expect(await testDb.stripeCheckoutAttempt.count()).toBe(0)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('reads a bound old Session after sales close without another create', async () => {
    const { f, order, attempt } = await bound()
    await setting('billing.enabled', false)
    await testDb.stripeCheckoutAttempt.update({
      where: { id: attempt.id }, data: { requestedAt: new Date(Date.now() - 25 * 3600_000) },
    })
    mocks.create.mockClear()
    await startStripeCheckout(f.ctx, { orderId: order.id, locale: 'zh' })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.retrieve).toHaveBeenCalledWith(attempt.sessionId)
    expect(await testDb.stripeCheckoutAttempt.count()).toBe(1)
  })

  it('never creates again for an unbound attempt outside the safe recovery window', async () => {
    const f = await billingFixture()
    const order = await stripeOrder(f)
    mocks.create.mockImplementationOnce(async (request: TrustedCheckoutRequest) => {
      await createExternal(request)
      throw new Error(PRIVATE + ' unknown result')
    })
    await expect(startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' }))
      .rejects.toMatchObject({ httpStatus: 503 })
    await testDb.stripeCheckoutAttempt.update({
      where: { orderId: order.id }, data: { requestedAt: new Date(Date.now() - 25 * 3600_000) },
    })
    mocks.create.mockClear()
    await expect(startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' }))
      .rejects.toMatchObject({ httpStatus: 503 })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(await testDb.stripeCheckoutAttempt.findUnique({ where: { orderId: order.id } }))
      .toMatchObject({ state: 'RECONCILIATION_REQUIRED', sessionId: null })
    const sessionId = [...sessions.keys()][0]
    markPaid(sessionId)
    await expect(handleStripeWebhook(event(sessionId))).rejects.toMatchObject({ httpStatus: 503 })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.alert.mock.calls.length + mocks.logger.error.mock.calls.length).toBeGreaterThan(0)
    await noDelivery(order.id, f.ctx.companyId)
  })

  it.each(['FAILED', 'EXPIRED'] as const)('does not replace a terminal %s attempt', async (state) => {
    const { f, order, attempt } = await bound()
    await testDb.stripeCheckoutAttempt.update({ where: { id: attempt.id }, data: { state } })
    mocks.create.mockClear()
    await expect(startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' })).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(await testDb.stripeCheckoutAttempt.findMany({ where: { orderId: order.id } }))
      .toEqual([expect.objectContaining({ id: attempt.id, sessionId: attempt.sessionId, state })])
  })

  it('rechecks OWNER and returns NOT_FOUND for a foreign order without creating an attempt', async () => {
    const f = await billingFixture()
    const order = await stripeOrder(f)
    const other = await createEmployer(testDb)
    await expect(startStripeCheckout({ ...other, role: 'OWNER' }, { orderId: order.id, locale: 'en' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    await testDb.companyMember.updateMany({ where: { userId: f.ctx.userId }, data: { role: 'RECRUITER' } })
    await expect(startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(await testDb.stripeCheckoutAttempt.count()).toBe(0)
  })
})

describe('M8-T03 arrival, durable binding and shared settlement', () => {
  it.each(['card', 'fpx'] as const)('settles %s once from a verified async success before completed', async (method) => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!, method)
    const afterCommit: string[] = []
    mocks.notify.mockImplementation(async () => {
      afterCommit.push((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status)
    })
    await setting('billing.enabled', false)
    await testDb.plan.update({ where: { id: f.plan.id }, data: { credits: 999, priceSen: 1, isActive: false } })
    await testDb.companyMember.deleteMany({ where: { userId: f.ctx.userId } })
    await handleStripeWebhook(event(attempt.sessionId!, 'checkout.session.async_payment_succeeded'))
    await handleStripeWebhook(event(attempt.sessionId!, 'checkout.session.completed', 'evt_completed_later'))
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({
      status: 'PAID', paymentMethod: method === 'card' ? 'CARD' : 'FPX',
      externalRef: attempt.sessionId, amountSen: order.amountSen, confirmedById: null,
    })
    expect(afterCommit).toEqual(['PAID'])
    await expectOneDelivery(order.id, f.ctx.companyId)
    expect(mocks.http.every((entry) => !entry.inTransaction && entry.lockFree)).toBe(true)
  })

  it('shares one atomic grant across repeated and different successful event IDs', async () => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!)
    const completed = event(attempt.sessionId!, 'checkout.session.completed', 'evt_same')
    await Promise.all([
      handleStripeWebhook(completed), handleStripeWebhook(completed),
      handleStripeWebhook(event(attempt.sessionId!, 'checkout.session.async_payment_succeeded', 'evt_other')),
    ])
    const paid = await testDb.order.findUniqueOrThrow({ where: { id: order.id } })
    await handleStripeWebhook(completed)
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(paid)
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it('rejects conflicting evidence on a paid replay without repeating or undoing the first grant', async () => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!)
    await handleStripeWebhook(event(attempt.sessionId!))
    const paid = await testDb.order.findUniqueOrThrow({ where: { id: order.id } })
    const payment = structuredClone(payments.get(attempt.paymentIntentId!)!)
    payment.amountReceivedSen -= 1
    mocks.retrievePayment.mockResolvedValue(payment)
    await expect(handleStripeWebhook(event(attempt.sessionId!, 'checkout.session.completed', 'evt_conflict')))
      .rejects.toMatchObject({ httpStatus: 400 })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(paid)
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it('leaves unpaid completed pending, then accepts later paid evidence for the same order', async () => {
    const { f, order, attempt } = await bound()
    sessions.set(attempt.sessionId!, { ...sessions.get(attempt.sessionId!)!, status: 'complete', url: null })
    await handleStripeWebhook(event(attempt.sessionId!))
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ status: 'PENDING' })
    await noDelivery(order.id, f.ctx.companyId)
    markPaid(attempt.sessionId!, 'fpx')
    await handleStripeWebhook(event(attempt.sessionId!, 'checkout.session.async_payment_succeeded', 'evt_async'))
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it.each(['checkout.session.expired', 'checkout.session.async_payment_failed'])(
    'does not downgrade a paid order when %s arrives late',
    async (type) => {
      const { f, order, attempt } = await bound()
      markPaid(attempt.sessionId!)
      await handleStripeWebhook(event(attempt.sessionId!))
      const paid = await testDb.order.findUniqueOrThrow({ where: { id: order.id } })
      const late = event(attempt.sessionId!, type, 'evt_late')
      Object.assign(late.data.object, {
        status: type === 'checkout.session.expired' ? 'expired' : 'complete', payment_status: 'unpaid',
      })
      await handleStripeWebhook(late)
      expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(paid)
      await expectOneDelivery(order.id, f.ctx.companyId)
    },
  )

  it('settles a credit pack through the shared ledger without a subscription', async () => {
    const { f, order, attempt } = await bound('CREDIT_PACK')
    markPaid(attempt.sessionId!)
    await handleStripeWebhook(event(attempt.sessionId!))
    await expectOneDelivery(order.id, f.ctx.companyId, 10, 0)
    expect(await testDb.creditLedger.findFirst({ where: { refType: 'Order', refId: order.id } }))
      .toMatchObject({ reason: 'PURCHASE' })
  })

  it('does not bind an unknown Session solely from signed order metadata', async () => {
    const f = await billingFixture()
    const order = await stripeOrder(f)
    const foreign = newSession({
      orderId: order.id, companyId: f.ctx.companyId, amountSen: order.amountSen,
      currency: 'MYR', productName: f.plan.nameEn, idempotencyKey: 'foreign-key',
      successUrl: 'https://payments.example.test/en/e/billing/' + order.id,
      cancelUrl: 'https://payments.example.test/en/e/billing/' + order.id,
    })
    markPaid(foreign.sessionId)
    await expect(handleStripeWebhook(event(foreign.sessionId))).rejects.toMatchObject({ httpStatus: 400 })
    expect(await testDb.stripeCheckoutAttempt.count()).toBe(0)
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ externalRef: null })
    expect(alerts()).toContain('checkout.session.completed')
    expect(alerts()).toContain(order.id)
    expect(alerts()).not.toContain(PRIVATE)
    await noDelivery(order.id, f.ctx.companyId)
  })

  it('returns retryable failure for temporarily unbound arrival and settles after trusted recovery', async () => {
    const f = await billingFixture()
    const order = await stripeOrder(f)
    mocks.failBinding = true
    await expect(startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' }))
      .rejects.toMatchObject({ httpStatus: 503 })
    const sessionId = [...sessions.keys()][0]
    markPaid(sessionId)
    mocks.create.mockRejectedValueOnce(new Error(PRIVATE + ' recovery unavailable'))
    await expect(handleStripeWebhook(event(sessionId))).rejects.toMatchObject({ httpStatus: 503 })
    await noDelivery(order.id, f.ctx.companyId)
    // Recover the original create response; current retrieve remains paid.
    mocks.create.mockReset().mockImplementation(createExternal)
    mocks.failBinding = false
    await handleStripeWebhook(event(sessionId))
    expect(await testDb.stripeCheckoutAttempt.findUnique({ where: { orderId: order.id } }))
      .toMatchObject({ sessionId, paymentIntentId: sessions.get(sessionId)!.paymentIntentId })
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it('rolls back a failed confirmation audit and retries the same event exactly once', async () => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!)
    const incoming = event(attempt.sessionId!)
    mocks.failAudit = true
    const failed: unknown = await handleStripeWebhook(incoming).catch((error: unknown) => error)
    expect(failed).toMatchObject({ httpStatus: 503 })
    expect(text(failed)).not.toContain(PRIVATE)
    expect(alerts()).not.toContain(PRIVATE)
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(
      expect.objectContaining({ status: 'PENDING', paidAt: null }),
    )
    await noDelivery(order.id, f.ctx.companyId)
    mocks.failAudit = false
    await handleStripeWebhook(incoming)
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it('does not replay a committed grant when post-commit notification fails', async () => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!)
    mocks.notify.mockRejectedValue(new Error(PRIVATE + ' notification failed'))
    await expect(handleStripeWebhook(event(attempt.sessionId!))).resolves.toBeUndefined()
    await expect(handleStripeWebhook(event(attempt.sessionId!, 'checkout.session.completed', 'evt_retry')))
      .resolves.toBeUndefined()
    await expectOneDelivery(order.id, f.ctx.companyId)
    expect(alerts()).not.toContain(PRIVATE)
  })

  it('rejects bank confirmation for STRIPE and Stripe start for a bank order', async () => {
    const { f, order } = await bound()
    await expect(confirmBankOrder(f.adminCtx, {
      orderId: order.id, receivedAmountSen: order.amountSen, note: 'Synthetic incorrect channel',
    })).rejects.toThrow()
    const bankFixture = await billingFixture('CREDIT_PACK')
    const bankOrder = await pendingOrder(bankFixture)
    mocks.create.mockClear()
    await expect(startStripeCheckout(bankFixture.ctx, { orderId: bankOrder.id, locale: 'en' })).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
    await noDelivery(order.id, f.ctx.companyId)
  })

  it('does not treat success navigation or an OWNER order read as payment evidence', async () => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!)
    mocks.retrieve.mockClear()
    mocks.retrievePayment.mockClear()
    const navigationInput = { orderId: order.id, checkout: 'success', session_id: attempt.sessionId }
    const detail = await getMyOrder(f.ctx, navigationInput)
    expect(detail).toMatchObject({ id: order.id, status: 'PENDING', paidAt: null })
    expect(mocks.retrieve).not.toHaveBeenCalled()
    expect(mocks.retrievePayment).not.toHaveBeenCalled()
    await noDelivery(order.id, f.ctx.companyId)
  })

  it('acknowledges an unsubscribed event with no provider or funds calls', async () => {
    const { f, order, attempt } = await bound()
    mocks.retrieve.mockClear()
    await expect(handleStripeWebhook(event(attempt.sessionId!, 'customer.updated'))).resolves.toBeUndefined()
    expect(mocks.retrieve).not.toHaveBeenCalled()
    await noDelivery(order.id, f.ctx.companyId)
  })
})

const rejectedEvidence: Array<{
  name: string
  change: (session: CheckoutObservation, payment: PaymentObservation) => void
}> = [
  { name: 'Session ID', change: (s) => { s.sessionId = 'cs_test_other' } },
  { name: 'Session mode', change: (s) => { Object.assign(s, { mode: 'subscription' }) } },
  { name: 'Session livemode', change: (s) => { s.livemode = true } },
  { name: 'Session amount', change: (s) => { s.amountTotalSen! -= 1 } },
  { name: 'Session currency', change: (s) => { s.currency = 'usd' } },
  { name: 'Session client reference', change: (s) => { s.clientReferenceId = 'other-order' } },
  { name: 'Session order metadata', change: (s) => { s.orderId = 'other-order' } },
  { name: 'Session company metadata', change: (s) => { s.companyId = 'other-company' } },
  { name: 'Session PI binding', change: (s) => { s.paymentIntentId = 'pi_other' } },
  { name: 'no-payment-required', change: (s) => { s.paymentStatus = 'no_payment_required' } },
  { name: 'PI ID', change: (_s, p) => { p.paymentIntentId = 'pi_other' } },
  { name: 'PI livemode', change: (_s, p) => { p.livemode = true } },
  { name: 'PI amount', change: (_s, p) => { p.amountSen -= 1 } },
  { name: 'PI received amount', change: (_s, p) => { p.amountReceivedSen -= 1 } },
  { name: 'PI currency', change: (_s, p) => { p.currency = 'usd' } },
  { name: 'PI order metadata', change: (_s, p) => { p.orderId = 'other-order' } },
  { name: 'PI company metadata', change: (_s, p) => { p.companyId = 'other-company' } },
  { name: 'Charge PI binding', change: (_s, p) => { p.latestCharge!.paymentIntentId = 'pi_other' } },
  { name: 'Charge livemode', change: (_s, p) => { p.latestCharge!.livemode = true } },
  { name: 'Charge amount', change: (_s, p) => { p.latestCharge!.amountSen -= 1 } },
  { name: 'Charge currency', change: (_s, p) => { p.latestCharge!.currency = 'usd' } },
  { name: 'Charge not paid', change: (_s, p) => { p.latestCharge!.paid = false } },
  { name: 'Charge failed', change: (_s, p) => { p.latestCharge!.status = 'failed' } },
  { name: 'Charge refund', change: (_s, p) => { p.latestCharge!.refunded = true } },
  { name: 'Charge partial refund', change: (_s, p) => { p.latestCharge!.amountRefundedSen = 1 } },
  { name: 'unsupported method', change: (_s, p) => { p.latestCharge!.paymentMethod = null } },
]

describe('M8-T03 rejected and incomplete observations', () => {
  it.each(rejectedEvidence)('rejects $name as permanent 400 with safe alert and no funds', async ({ change }) => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!)
    const incoming = event(attempt.sessionId!)
    const session = structuredClone(sessions.get(attempt.sessionId!)!)
    const payment = structuredClone(payments.get(session.paymentIntentId!)!)
    change(session, payment)
    mocks.retrieve.mockResolvedValue(session)
    mocks.retrievePayment.mockResolvedValue(payment)
    await expect(handleStripeWebhook(incoming)).rejects.toMatchObject({ httpStatus: 400 })
    expect(alerts()).toContain(incoming.type)
    expect(alerts()).toContain(order.id)
    expect(alerts()).not.toContain(PRIVATE)
    expect(alerts()).not.toContain(text(incoming))
    await noDelivery(order.id, f.ctx.companyId)
  })

  it.each(['livemode', 'session-id', 'amount', 'object'] as const)(
    'rejects incompatible signed event %s before granting',
    async (field) => {
      const { f, order, attempt } = await bound()
      markPaid(attempt.sessionId!)
      const incoming = event(attempt.sessionId!)
      if (field === 'livemode') incoming.livemode = true
      if (field === 'session-id') Object.assign(incoming.data.object, { id: 'cs_test_unknown' })
      if (field === 'amount') Object.assign(incoming.data.object, { amount_total: order.amountSen - 1 })
      if (field === 'object') Object.assign(incoming.data.object, { object: 'payment_intent' })
      await expect(handleStripeWebhook(incoming)).rejects.toMatchObject({ httpStatus: 400 })
      expect(alerts()).not.toContain(PRIVATE)
      await noDelivery(order.id, f.ctx.companyId)
    },
  )

  it.each(['null-pi', 'processing-pi', 'missing-charge'] as const)(
    'keeps %s retryable instead of losing an incomplete paid arrival',
    async (missing) => {
      const { f, order, attempt } = await bound()
      markPaid(attempt.sessionId!)
      const incoming = event(attempt.sessionId!)
      const session = structuredClone(sessions.get(attempt.sessionId!)!)
      const payment = structuredClone(payments.get(session.paymentIntentId!)!)
      if (missing === 'null-pi') session.paymentIntentId = null
      if (missing === 'processing-pi') payment.status = 'processing'
      if (missing === 'missing-charge') payment.latestCharge = null
      mocks.retrieve.mockResolvedValue(session)
      mocks.retrievePayment.mockResolvedValue(payment)
      await expect(handleStripeWebhook(incoming)).rejects.toMatchObject({ httpStatus: 503 })
      await noDelivery(order.id, f.ctx.companyId)
      mocks.retrieve.mockImplementation(retrieveExternal)
      mocks.retrievePayment.mockImplementation(retrievePaymentExternal)
      await handleStripeWebhook(incoming)
      await expectOneDelivery(order.id, f.ctx.companyId)
    },
  )

  it.each(['CANCELLED', 'REFUNDED'] as const)('does not revive a terminal %s order', async (status) => {
    const { f, order, attempt } = await bound()
    await testDb.order.update({ where: { id: order.id }, data: { status } })
    markPaid(attempt.sessionId!)
    await expect(handleStripeWebhook(event(attempt.sessionId!))).rejects.toMatchObject({ httpStatus: 400 })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ status })
    await noDelivery(order.id, f.ctx.companyId)
  })

  it('retries a transient provider failure without processing the event prematurely', async () => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!)
    const incoming = event(attempt.sessionId!)
    mocks.retrievePayment.mockRejectedValueOnce(new Error(PRIVATE + ' transient read failure'))
    const caught: unknown = await handleStripeWebhook(incoming).catch((error: unknown) => error)
    expect(caught).toMatchObject({ httpStatus: 503 })
    expect(text(caught)).not.toContain(PRIVATE)
    expect(alerts()).not.toContain(PRIVATE)
    await noDelivery(order.id, f.ctx.companyId)
    await handleStripeWebhook(incoming)
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it('binds a previously null PI only from its persisted Session and then settles', async () => {
    const f = await billingFixture()
    const order = await stripeOrder(f)
    mocks.create.mockImplementationOnce(async (request: TrustedCheckoutRequest) => ({
      ...await createExternal(request), paymentIntentId: null,
    }))
    await startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' })
    const attempt = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(attempt.paymentIntentId).toBeNull()
    markPaid(attempt.sessionId!)
    await handleStripeWebhook(event(attempt.sessionId!))
    expect(await testDb.stripeCheckoutAttempt.findUnique({ where: { orderId: order.id } }))
      .toMatchObject({ paymentIntentId: sessions.get(attempt.sessionId!)!.paymentIntentId })
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it('settles the discounted odd sen net amount without subtracting the discount again', async () => {
    const f = await billingFixture('PLAN', 299901)
    await foundingOffer(f)
    const order = await stripeOrder(f)
    await startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' })
    const attempt = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { orderId: order.id } })
    markPaid(attempt.sessionId!, 'fpx')
    await handleStripeWebhook(event(attempt.sessionId!))
    expect(await testDb.order.findUnique({ where: { id: order.id } }))
      .toMatchObject({ status: 'PAID', amountSen: 149951, discountSen: 149950 })
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(f.ctx.companyId, { orderId: order.id, amountSen: 149951 })
    await expectOneDelivery(order.id, f.ctx.companyId)
  })
})

describe('M8-T03 CREDIT lock revalidation', () => {
  it.each(['session', 'payment-intent', 'net-amount', 'currency', 'mode'] as const)(
    're-reads changed persistent %s after verified provider evidence waits for the lock',
    async (changed) => {
      const { f, order, attempt } = await bound()
      markPaid(attempt.sessionId!)
      const observed = deferred()
      const returnEvidence = deferred()
      mocks.retrievePayment.mockImplementationOnce(async (id: string) => {
        const evidence = await retrievePaymentExternal(id)
        observed.resolve()
        await returnEvidence.promise
        return evidence
      })
      const incoming = handleStripeWebhook(event(attempt.sessionId!))
      void incoming.catch(() => undefined)
      const acquired = deferred()
      const mutate = deferred()
      const mutated = deferred()
      const release = deferred()
      let holder: Promise<void> | undefined
      try {
        await Promise.race([
          observed.promise,
          incoming.then(() => { throw new Error('Handler ended before reading payment evidence') }),
        ])
        holder = testDb.$transaction(async (tx) => {
          await lockXact(tx, LOCK_NS.CREDIT, f.ctx.companyId)
          acquired.resolve()
          await mutate.promise
          if (changed === 'session') {
            await tx.stripeCheckoutAttempt.update({ where: { id: attempt.id }, data: { sessionId: 'cs_test_rebound' } })
            await tx.order.update({ where: { id: order.id }, data: { externalRef: 'cs_test_rebound' } })
          } else if (changed === 'payment-intent') {
            await tx.stripeCheckoutAttempt.update({ where: { id: attempt.id }, data: { paymentIntentId: 'pi_rebound' } })
          } else if (changed === 'net-amount') {
            await tx.order.update({ where: { id: order.id }, data: { amountSen: order.amountSen + 1 } })
          } else if (changed === 'currency') {
            await tx.order.update({ where: { id: order.id }, data: { currency: 'USD' } })
          } else {
            await tx.stripeCheckoutAttempt.update({
              where: { id: attempt.id },
              data: { requestSnapshot: { ...(attempt.requestSnapshot as Prisma.JsonObject), mode: 'live' } },
            })
          }
          mutated.resolve()
          await release.promise
        }, { timeout: 15000 })
        await Promise.race([acquired.promise, holder.then(() => { throw new Error('Holder ended before acquiring CREDIT') })])
        returnEvidence.resolve()
        await expect.poll(async () => {
          const [row] = await testDb.$queryRaw<Array<{ waiting: number }>>(Prisma.sql`
            SELECT count(*)::int AS waiting FROM pg_locks
            WHERE locktype = 'advisory' AND NOT granted
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND classid = ${LOCK_NS.CREDIT}::oid AND objid = hashtext(${f.ctx.companyId})::oid
          `)
          return row.waiting
        }, { timeout: 3000, interval: 20 }).toBeGreaterThan(0)
        mutate.resolve()
        await Promise.race([mutated.promise, holder.then(() => { throw new Error('Holder ended before mutation') })])
      } finally {
        returnEvidence.resolve()
        mutate.resolve()
        release.resolve()
        if (holder) await holder
        await expect(incoming).rejects.toMatchObject({ httpStatus: 400 })
      }
      await noDelivery(order.id, f.ctx.companyId)
      expect(mocks.http.every((entry) => !entry.inTransaction && entry.lockFree)).toBe(true)
    },
  )
})

describe('M8-T03 FPX receipt persistence and OWNER projection', () => {
  it('freezes Charge receipt facts and projects a local, whitelisted net-MYR receipt', async () => {
    const f = await billingFixture('PLAN', 299901)
    await foundingOffer(f)
    const order = await stripeOrder(f)
    await startStripeCheckout(f.ctx, { orderId: order.id, locale: 'en' })
    const attempt = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(order).toMatchObject({ amountSen: 149951, discountSen: 149950 })
    markPaid(attempt.sessionId!, 'fpx')
    const payment = payments.get(attempt.paymentIntentId!)!
    const charge = payment.latestCharge!
    const createdAt = '2024-02-03T04:05:06.000Z'
    Object.assign(charge, {
      createdAt, statementDescriptor: 'SYNTHETIC SELLER REF',
      unknownReceiptField: PRIVATE, receiptUrl: 'https://private.example.test/' + PRIVATE,
    })
    Object.assign(charge.fpx!, { accountNumber: PRIVATE, holderName: PRIVATE })
    const expected = {
      version: 1, createdAt, amountSen: order.amountSen, currency: 'MYR',
      orderNo: order.orderNo, sellerOrderNo: 'SYNTHETIC SELLER REF',
      transactionId: 'SYNTHETIC_FPX_TX_001', bankCode: 'maybank2u', status: 'succeeded',
    }
    await handleStripeWebhook(event(attempt.sessionId!))
    const persisted = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    expect(persisted).toMatchObject({ state: 'SUCCEEDED', fpxReceipt: expected })
    expect(persisted.fpxReceipt).toEqual(expected)
    expect(text(persisted.fpxReceipt)).not.toContain(PRIVATE)
    expect(order.orderNo).not.toBe(expected.sellerOrderNo)
    const paid = await testDb.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(paid.paidAt?.toISOString()).not.toBe(createdAt)

    for (const mock of [mocks.create, mocks.retrieve, mocks.retrievePayment, mocks.expire]) mock.mockClear()
    const detail = await getMyOrder(f.ctx, { orderId: order.id })
    expect(detail.stripePayment).toEqual({
      state: 'SUCCEEDED',
      fpxReceipt: {
        createdAt, amountSen: order.amountSen, currency: 'MYR', orderNo: order.orderNo,
        sellerOrderNo: 'SYNTHETIC SELLER REF', transactionId: 'SYNTHETIC_FPX_TX_001',
        bankName: 'Maybank2U', status: 'succeeded',
      },
    })
    for (const secret of [
      attempt.sessionId!, attempt.paymentIntentId!, charge.chargeId, attempt.idempotencyKey,
      PRIVATE, 'maybank2u', 'checkout.stripe.com', 'requestSnapshot', 'bankCode', 'version',
    ]) expect(text(detail.stripePayment)).not.toContain(secret)
    for (const secret of [attempt.sessionId!, attempt.paymentIntentId!, charge.chargeId, attempt.idempotencyKey, PRIVATE]) {
      expect(text(detail)).not.toContain(secret)
    }
    for (const mock of [mocks.create, mocks.retrieve, mocks.retrievePayment, mocks.expire]) expect(mock).not.toHaveBeenCalled()
    expect(await testDb.stripeCheckoutAttempt.findUnique({ where: { id: attempt.id } })).toEqual(persisted)
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(paid)
    const audit = await testDb.auditLog.findMany({ where: { action: 'order.confirm', targetId: order.id } })
    for (const value of [PRIVATE, expected.sellerOrderNo, expected.transactionId, 'maybank2u']) {
      expect(text(audit)).not.toContain(value)
      expect(alerts()).not.toContain(value)
      expect(text(mocks.notify.mock.calls)).not.toContain(value)
    }
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it.each(['descriptor', 'transaction-id', 'unknown-bank'] as const)(
    'settles FPX with a nullable or forward-compatible %s without inventing display facts',
    async (missing) => {
      const { f, order, attempt } = await bound()
      markPaid(attempt.sessionId!, 'fpx')
      const charge = payments.get(attempt.paymentIntentId!)!.latestCharge!
      if (missing === 'descriptor') charge.statementDescriptor = null
      if (missing === 'transaction-id') charge.fpx!.transactionId = null
      if (missing === 'unknown-bank') charge.fpx!.bankCode = 'future_bank_xyz'
      await handleStripeWebhook(event(attempt.sessionId!))
      const persisted = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
      expect(persisted).toMatchObject({
        state: 'SUCCEEDED',
        fpxReceipt: {
          orderNo: order.orderNo,
          sellerOrderNo: missing === 'descriptor' ? null : 'SYNTHETIC SELLER ORDER',
          transactionId: missing === 'transaction-id' ? null : 'SYNTHETIC_FPX_TX_001',
          bankCode: missing === 'unknown-bank' ? 'future_bank_xyz' : 'maybank2u',
        },
      })
      const detail = await getMyOrder(f.ctx, { orderId: order.id })
      expect(detail).toMatchObject({
        status: 'PAID', paymentMethod: 'FPX',
        stripePayment: {
          state: 'SUCCEEDED',
          fpxReceipt: {
            orderNo: order.orderNo,
            sellerOrderNo: missing === 'descriptor' ? null : 'SYNTHETIC SELLER ORDER',
            transactionId: missing === 'transaction-id' ? null : 'SYNTHETIC_FPX_TX_001',
            bankName: missing === 'unknown-bank' ? null : 'Maybank2U',
          },
        },
      })
      expect(detail.stripePayment?.fpxReceipt?.sellerOrderNo).not.toBe(order.orderNo)
      expect(text(detail.stripePayment)).not.toContain('future_bank_xyz')
      await expectOneDelivery(order.id, f.ctx.companyId)
    },
  )

  it('keeps the first receipt including nulls stable on reads and a different success event', async () => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!, 'fpx')
    const charge = payments.get(attempt.paymentIntentId!)!.latestCharge!
    charge.statementDescriptor = null
    charge.fpx!.transactionId = null
    await handleStripeWebhook(event(attempt.sessionId!, 'checkout.session.async_payment_succeeded', 'evt_receipt_first'))
    const first = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    const originalOrder = await testDb.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(first.fpxReceipt).toMatchObject({ sellerOrderNo: null, transactionId: null })
    charge.statementDescriptor = 'LATER SELLER VALUE'
    charge.fpx!.transactionId = 'LATER_FPX_VALUE'
    charge.fpx!.bankCode = 'cimb'
    charge.createdAt = '2025-03-04T05:06:07.000Z'
    for (const mock of [mocks.create, mocks.retrieve, mocks.retrievePayment, mocks.expire]) mock.mockClear()
    const read = await getMyOrder(f.ctx, { orderId: order.id })
    expect(read.stripePayment?.fpxReceipt).toMatchObject({
      sellerOrderNo: null, transactionId: null, bankName: 'Maybank2U',
    })
    for (const mock of [mocks.create, mocks.retrieve, mocks.retrievePayment, mocks.expire]) expect(mock).not.toHaveBeenCalled()
    await handleStripeWebhook(event(attempt.sessionId!, 'checkout.session.completed', 'evt_receipt_second'))
    expect((await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).fpxReceipt)
      .toEqual(first.fpxReceipt)
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(originalOrder)
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it.each(['audit', 'receipt-write'] as const)(
    'rolls back receipt and delivery together after the real %s write and retries once',
    async (failure) => {
      const { f, order, attempt } = await bound()
      markPaid(attempt.sessionId!, 'fpx')
      mocks.failAudit = failure === 'audit'
      mocks.failReceipt = failure === 'receipt-write'
      const incoming = event(attempt.sessionId!, 'checkout.session.async_payment_succeeded', 'evt_receipt_rollback')
      const caught: unknown = await handleStripeWebhook(incoming).catch((error: unknown) => error)
      expect(caught).toMatchObject({ httpStatus: 503 })
      expect(text(caught)).not.toContain(PRIVATE)
      const rolledBack = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
      expect(rolledBack.fpxReceipt).toBeNull()
      expect(rolledBack.state).not.toBe('SUCCEEDED')
      expect(await testDb.order.findUnique({ where: { id: order.id } }))
        .toMatchObject({ status: 'PENDING', paidAt: null, paymentMethod: null })
      await noDelivery(order.id, f.ctx.companyId)
      mocks.failAudit = false
      mocks.failReceipt = false
      await handleStripeWebhook(incoming)
      const settled = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
      expect(settled).toMatchObject({
        state: 'SUCCEEDED',
        fpxReceipt: { orderNo: order.orderNo, transactionId: 'SYNTHETIC_FPX_TX_001', status: 'succeeded' },
      })
      await expectOneDelivery(order.id, f.ctx.companyId)
    },
  )

  it('stores and returns no FPX receipt for a successful card payment', async () => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!, 'card')
    await handleStripeWebhook(event(attempt.sessionId!))
    expect(await testDb.stripeCheckoutAttempt.findUnique({ where: { id: attempt.id } }))
      .toMatchObject({ state: 'SUCCEEDED', fpxReceipt: null })
    expect(await getMyOrder(f.ctx, { orderId: order.id })).toMatchObject({
      status: 'PAID', paymentMethod: 'CARD',
      stripePayment: { state: 'SUCCEEDED', fpxReceipt: null },
    })
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it('projects only known stored receipt fields without returning internal bindings or touching provider', async () => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!, 'fpx')
    await handleStripeWebhook(event(attempt.sessionId!))
    const original = await getMyOrder(f.ctx, { orderId: order.id })
    expect(original.stripePayment?.fpxReceipt).toMatchObject({ orderNo: order.orderNo })
    const saved = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    expect(saved.fpxReceipt).not.toBeNull()
    await testDb.stripeCheckoutAttempt.update({
      where: { id: attempt.id },
      data: { fpxReceipt: {
        ...(saved.fpxReceipt as Prisma.JsonObject),
        sessionId: attempt.sessionId, paymentIntentId: attempt.paymentIntentId,
        chargeId: payments.get(attempt.paymentIntentId!)!.latestCharge!.chargeId,
        idempotencyKey: attempt.idempotencyKey, requestSnapshot: saved.requestSnapshot,
        privateExtra: PRIVATE, nestedExtra: { accountNumber: PRIVATE },
      } },
    })
    const beforeRead = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    for (const mock of [mocks.create, mocks.retrieve, mocks.retrievePayment, mocks.expire]) mock.mockClear()
    const detail = await getMyOrder(f.ctx, { orderId: order.id })
    expect(detail.stripePayment).toEqual(original.stripePayment)
    expect(text(detail)).not.toContain(PRIVATE)
    for (const mock of [mocks.create, mocks.retrieve, mocks.retrievePayment, mocks.expire]) expect(mock).not.toHaveBeenCalled()
    expect(await testDb.stripeCheckoutAttempt.findUnique({ where: { id: attempt.id } })).toEqual(beforeRead)
    await expectOneDelivery(order.id, f.ctx.companyId)
  })

  it.each(['version', 'amount', 'date'] as const)(
    'hides a malformed stored receipt %s while preserving paid order truth and local data',
    async (broken) => {
      const { f, order, attempt } = await bound()
      markPaid(attempt.sessionId!, 'fpx')
      await handleStripeWebhook(event(attempt.sessionId!))
      const saved = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
      const invalid: Prisma.JsonObject = { ...(saved.fpxReceipt as Prisma.JsonObject), privateExtra: PRIVATE }
      if (broken === 'version') invalid.version = 99
      if (broken === 'amount') invalid.amountSen = order.amountSen + 1
      if (broken === 'date') invalid.createdAt = 'not-a-date'
      await testDb.stripeCheckoutAttempt.update({ where: { id: attempt.id }, data: { fpxReceipt: invalid } })
      const beforeRead = await testDb.stripeCheckoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
      for (const mock of [mocks.create, mocks.retrieve, mocks.retrievePayment, mocks.expire]) mock.mockClear()
      const detail = await getMyOrder(f.ctx, { orderId: order.id })
      expect(detail).toMatchObject({
        status: 'PAID', paymentMethod: 'FPX',
        stripePayment: { state: 'SUCCEEDED', fpxReceipt: null },
      })
      expect(text(detail)).not.toContain(PRIVATE)
      expect(alerts()).not.toContain(PRIVATE)
      expect(alerts()).toContain(order.id)
      for (const mock of [mocks.create, mocks.retrieve, mocks.retrievePayment, mocks.expire]) expect(mock).not.toHaveBeenCalled()
      expect(await testDb.stripeCheckoutAttempt.findUnique({ where: { id: attempt.id } })).toEqual(beforeRead)
      await expectOneDelivery(order.id, f.ctx.companyId)
    },
  )

  it('does not expose a successful receipt to another company or a former OWNER', async () => {
    const { f, order, attempt } = await bound()
    markPaid(attempt.sessionId!, 'fpx')
    await handleStripeWebhook(event(attempt.sessionId!))
    const other = await createEmployer(testDb)
    await expect(getMyOrder({ ...other, role: 'OWNER' }, { orderId: order.id }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    await testDb.companyMember.updateMany({ where: { userId: f.ctx.userId }, data: { role: 'RECRUITER' } })
    await expect(getMyOrder(f.ctx, { orderId: order.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expectOneDelivery(order.id, f.ctx.companyId)
  })
})
