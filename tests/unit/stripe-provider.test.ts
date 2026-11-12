/**
 * M8-T03 offline provider contract.
 * The Stripe constructor is completely mocked. No live client, env, Prisma,
 * credentials, database, or network is needed. Service settlement is out of scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrustedCheckoutRequest } from '@/server/payments/types'

const mocks = vi.hoisted(() => ({
  Stripe: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
  retrievePayment: vi.fn(),
  retrieveCharge: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('stripe', () => ({ default: mocks.Stripe, Stripe: mocks.Stripe }))
vi.mock('@/env', () => {
  throw new Error('Provider requires explicit configuration, not ambient environment')
})
vi.mock('@/server/lib/logger', () => ({ logger: mocks.logger }))

import { createStripePaymentProvider } from '@/server/payments/stripe'

const TEST_KEY = 'sk_test_t03_synthetic_only'
const LIVE_KEY = 'sk_live_t03_synthetic_only'
const PRIVATE_VALUE = 'SYNTHETIC_PRIVATE_PAYMENT_VALUE'
const SESSION_ID = 'cs_test_t03_synthetic'
const PAYMENT_ID = 'pi_t03_synthetic'
const CHARGE_ID = 'ch_t03_synthetic'
const HOSTED_URL = 'https://checkout.stripe.com/c/pay/cs_test_t03_synthetic#synthetic'
const request: TrustedCheckoutRequest = {
  orderId: 'order-t03-synthetic',
  companyId: 'company-t03-synthetic',
  amountSen: 149950,
  currency: 'MYR',
  productName: '冻结年度套餐',
  successUrl: 'https://payments.example.test/en/e/billing/orders/order-t03-synthetic?checkout=success',
  cancelUrl: 'https://payments.example.test/en/e/billing/orders/order-t03-synthetic?checkout=cancel',
  idempotencyKey: 'checkout-attempt-t03-synthetic',
}
const metadata = { orderId: request.orderId, companyId: request.companyId }

function session(overrides: Record<string, unknown> = {}) {
  return {
    object: 'checkout.session',
    id: SESSION_ID,
    url: HOSTED_URL,
    mode: 'payment',
    status: 'open',
    payment_status: 'unpaid',
    amount_total: request.amountSen,
    currency: 'myr',
    client_reference_id: request.orderId,
    metadata: { ...metadata, privateExtra: PRIVATE_VALUE },
    payment_intent: null,
    livemode: false,
    customer_details: { email: PRIVATE_VALUE },
    ...overrides,
  }
}

function charge(overrides: Record<string, unknown> = {}) {
  return {
    object: 'charge',
    id: CHARGE_ID,
    payment_intent: PAYMENT_ID,
    created: 1_794_268_800,
    statement_descriptor: 'SYNTHETIC SELLER ORDER',
    status: 'succeeded',
    paid: true,
    amount: request.amountSen,
    currency: 'myr',
    livemode: false,
    refunded: false,
    amount_refunded: 0,
    payment_method_details: {
      type: 'fpx',
      fpx: { bank: 'maybank2u', transaction_id: 'SYNTHETIC_FPX_TX_001', privateExtra: PRIVATE_VALUE },
    },
    billing_details: { email: PRIVATE_VALUE },
    ...overrides,
  }
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    object: 'payment_intent',
    id: PAYMENT_ID,
    status: 'succeeded',
    amount: request.amountSen,
    amount_received: request.amountSen,
    currency: 'myr',
    metadata: { ...metadata, privateExtra: PRIVATE_VALUE },
    livemode: false,
    latest_charge: CHARGE_ID,
    ...overrides,
  }
}

function provider(mode: 'test' | 'live' = 'test') {
  return createStripePaymentProvider({ secretKey: mode === 'test' ? TEST_KEY : LIVE_KEY, mode })
}

function serialized(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => item instanceof Error
    ? Object.fromEntries(Object.getOwnPropertyNames(item).map((key) => [
      key, (item as unknown as Record<string, unknown>)[key],
    ]))
    : item)
}

function loggedText() {
  return serialized(Object.values(mocks.logger).flatMap((mock) => mock.mock.calls))
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.Stripe.mockImplementation(function () {
    return {
      checkout: { sessions: { create: mocks.create, retrieve: mocks.retrieve, expire: mocks.expire } },
      paymentIntents: { retrieve: mocks.retrievePayment },
      charges: { retrieve: mocks.retrieveCharge },
    }
  })
  mocks.create.mockResolvedValue(session())
  mocks.retrieve.mockResolvedValue(session())
  mocks.expire.mockResolvedValue(session({ status: 'expired', url: null }))
  mocks.retrievePayment.mockResolvedValue(payment())
  mocks.retrieveCharge.mockResolvedValue(charge())
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('Network is forbidden in the offline provider unit test')
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('M8-T03 Stripe provider configuration and exact create request', () => {
  it('is lazy even without configuration, and fails only when used', async () => {
    const unconfigured = createStripePaymentProvider({})
    expect(mocks.Stripe).not.toHaveBeenCalled()
    await expect(unconfigured.createCheckout(request)).rejects.toMatchObject({
      code: 'PAYMENT_UNAVAILABLE', httpStatus: 503,
    })
    expect(mocks.Stripe).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('defaults to test mode and initializes one bounded client on first use', async () => {
    const client = createStripePaymentProvider({ secretKey: TEST_KEY })
    expect(mocks.Stripe).not.toHaveBeenCalled()
    await client.createCheckout(request)
    await client.retrieveCheckout(SESSION_ID)
    expect(mocks.Stripe).toHaveBeenCalledExactlyOnceWith(TEST_KEY, {
      apiVersion: '2026-10-28.endive', timeout: 10_000, maxNetworkRetries: 0,
    })
  })

  it.each([
    { mode: 'test' as const, secretKey: LIVE_KEY },
    { mode: 'live' as const, secretKey: TEST_KEY },
    { mode: 'test' as const, secretKey: 'pk_test_synthetic_public_key' },
    { mode: 'test' as const, secretKey: 'not-a-stripe-secret' },
  ])('rejects unusable or mismatched $mode configuration before constructing SDK', async (config) => {
    await expect(createStripePaymentProvider(config).createCheckout(request)).rejects.toMatchObject({
      code: 'PAYMENT_UNAVAILABLE', httpStatus: 503,
    })
    expect(mocks.Stripe).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('accepts explicitly selected live mode only with a matching key and response', async () => {
    mocks.create.mockResolvedValue(session({
      id: 'cs_live_t03_synthetic',
      url: 'https://checkout.stripe.com/c/pay/cs_live_t03_synthetic',
      livemode: true,
    }))
    const result = await provider('live').createCheckout(request)
    expect(mocks.Stripe).toHaveBeenCalledWith(LIVE_KEY, expect.any(Object))
    expect(result.livemode).toBe(true)
  })

  it('sends the exact fixed-version payload with card + FPX and the frozen net amount', async () => {
    // Order list price was 299900 and discount 149950; amountSen is already net.
    await provider().createCheckout(request)
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      mode: 'payment',
      ui_mode: 'hosted_page',
      allowed_payment_method_types: ['card', 'fpx'],
      client_reference_id: request.orderId,
      metadata,
      payment_intent_data: { metadata },
      line_items: [{
        price_data: {
          currency: 'myr',
          unit_amount: 149950,
          product_data: { name: '冻结年度套餐' },
        },
        quantity: 1,
      }],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    }, { idempotencyKey: request.idempotencyKey })
  })

  it('keeps an odd net sen amount exact without RM conversion or discount arithmetic', async () => {
    mocks.create.mockResolvedValue(session({ amount_total: 149951 }))
    await provider().createCheckout({ ...request, amountSen: 149951 })
    expect(mocks.create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(149951)
  })

  it.each([0, -1, 1499.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects nonpositive or noninteger-safe sen %s before external creation',
    async (amountSen) => {
      await expect(provider().createCheckout({ ...request, amountSen })).rejects.toMatchObject({
        code: 'PAYMENT_REJECTED', httpStatus: 400,
      })
      expect(mocks.create).not.toHaveBeenCalled()
    },
  )

  it('uses identical frozen parameters and key on an explicit caller retry after timeout', async () => {
    const timeout = Object.assign(new Error('synthetic timeout'), {
      type: 'StripeConnectionError', code: 'ETIMEDOUT',
    })
    mocks.create.mockRejectedValueOnce(timeout)
    const client = provider()
    await expect(client.createCheckout(request)).rejects.toMatchObject({
      code: 'PAYMENT_UNAVAILABLE', httpStatus: 503,
    })
    await client.createCheckout(request)
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0])
    expect(mocks.create.mock.calls[1][1]).toEqual({ idempotencyKey: request.idempotencyKey })
  })

  it('projects the create response to a safe DTO, preserving a not-yet-created PaymentIntent', async () => {
    const result = await provider().createCheckout(request)
    expect(result).toEqual({
      sessionId: SESSION_ID,
      url: HOSTED_URL,
      mode: 'payment',
      status: 'open',
      paymentStatus: 'unpaid',
      amountTotalSen: request.amountSen,
      currency: 'myr',
      clientReferenceId: request.orderId,
      orderId: request.orderId,
      companyId: request.companyId,
      paymentIntentId: null,
      livemode: false,
    })
    expect(serialized(result)).not.toContain(PRIVATE_VALUE)
  })
})

describe('M8-T03 strict hosted URL and create response validation', () => {
  it.each([
    null,
    'http://checkout.stripe.com/c/pay/x',
    'https://checkout.stripe.com.evil.test/c/pay/x',
    'https://evilcheckout.stripe.com/c/pay/x',
    'https://custom-checkout.example.test/c/pay/x',
    'https://checkout.stripe.com@evil.test/c/pay/x',
    'https://user:pass@checkout.stripe.com/c/pay/x',
    'https://checkout.stripe.com:444/c/pay/x',
    '//checkout.stripe.com/c/pay/x',
    'javascript:alert(1)',
  ])('does not return an untrusted hosted URL %s', async (url) => {
    mocks.create.mockResolvedValue(session({ url }))
    await expect(provider().createCheckout(request)).rejects.toMatchObject({
      code: 'PAYMENT_REJECTED', httpStatus: 400,
    })
  })

  it.each([
    { object: 'payment_intent' },
    { mode: 'subscription' },
    { status: 'expired' },
    { amount_total: request.amountSen - 1 },
    { currency: 'usd' },
    { client_reference_id: 'other-order' },
    { metadata: { ...metadata, orderId: 'other-order' } },
    { metadata: { ...metadata, companyId: 'other-company' } },
    { livemode: true },
  ])('rejects a create result incompatible with the trusted snapshot: %j', async (overrides) => {
    mocks.create.mockResolvedValue(session(overrides))
    await expect(provider().createCheckout(request)).rejects.toMatchObject({
      code: 'PAYMENT_REJECTED', httpStatus: 400,
    })
  })
})

describe('M8-T03 normalized observations without settlement decisions', () => {
  it.each([
    null,
    PAYMENT_ID,
    { object: 'payment_intent', id: PAYMENT_ID, privateExtra: PRIVATE_VALUE },
  ])('normalizes nullable, ID, and expanded Session PaymentIntent references: %j', async (paymentIntent) => {
    mocks.retrieve.mockResolvedValue(session({ payment_intent: paymentIntent }))
    const result = await provider().retrieveCheckout(SESSION_ID)
    expect(mocks.retrieve.mock.calls[0][0]).toBe(SESSION_ID)
    expect(result.paymentIntentId).toBe(paymentIntent === null ? null : PAYMENT_ID)
    expect(serialized(result)).not.toContain(PRIVATE_VALUE)
  })

  it('preserves complete-but-unpaid and unknown money instead of declaring settlement', async () => {
    mocks.retrieve.mockResolvedValue(session({
      status: 'complete', payment_status: 'unpaid', amount_total: null, currency: null, url: null,
    }))
    const result = await provider().retrieveCheckout(SESSION_ID)
    expect(result).toMatchObject({
      status: 'complete', paymentStatus: 'unpaid', amountTotalSen: null, currency: null, url: null,
    })
    expect(mocks.retrievePayment).not.toHaveBeenCalled()
  })

  it('expires only the requested Session and returns its expired observation', async () => {
    const result = await provider().expireCheckout(SESSION_ID)
    expect(mocks.expire.mock.calls[0][0]).toBe(SESSION_ID)
    expect(result).toMatchObject({ sessionId: SESSION_ID, status: 'expired', url: null })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each(['retrieveCheckout', 'expireCheckout'] as const)(
    'rejects a different Session returned by %s',
    async (operation) => {
      mocks.retrieve.mockResolvedValue(session({ id: 'cs_test_other' }))
      mocks.expire.mockResolvedValue(session({ id: 'cs_test_other', status: 'expired', url: null }))
      await expect(provider()[operation](SESSION_ID)).rejects.toMatchObject({
        code: 'PAYMENT_REJECTED', httpStatus: 400,
      })
    },
  )

  it.each(['card', 'fpx'] as const)('reads actual %s from the Charge and strips private fields', async (method) => {
    mocks.retrieveCharge.mockResolvedValue(charge({ payment_method_details: {
      type: method,
      ...(method === 'fpx' ? { fpx: { bank: 'maybank2u', transaction_id: 'SYNTHETIC_FPX_TX_001' } } : {}),
    } }))
    const result = await provider().retrievePayment(PAYMENT_ID)
    expect(mocks.retrievePayment.mock.calls[0][0]).toBe(PAYMENT_ID)
    expect(mocks.retrieveCharge.mock.calls[0][0]).toBe(CHARGE_ID)
    expect(result).toEqual({
      paymentIntentId: PAYMENT_ID,
      status: 'succeeded',
      amountSen: request.amountSen,
      amountReceivedSen: request.amountSen,
      currency: 'myr',
      orderId: request.orderId,
      companyId: request.companyId,
      livemode: false,
      latestCharge: {
        chargeId: CHARGE_ID,
        paymentIntentId: PAYMENT_ID,
        createdAt: new Date(1_794_268_800_000).toISOString(),
        statementDescriptor: 'SYNTHETIC SELLER ORDER',
        fpx: method === 'fpx' ? { bankCode: 'maybank2u', transactionId: 'SYNTHETIC_FPX_TX_001' } : null,
        status: 'succeeded',
        paid: true,
        amountSen: request.amountSen,
        currency: 'myr',
        livemode: false,
        refunded: false,
        amountRefundedSen: 0,
        paymentMethod: method,
      },
    })
    expect(serialized(result)).not.toContain(PRIVATE_VALUE)
  })

  it('normalizes an expanded Charge and its expanded PaymentIntent without another Charge lookup', async () => {
    mocks.retrievePayment.mockResolvedValue(payment({
      latest_charge: charge({ payment_intent: { object: 'payment_intent', id: PAYMENT_ID } }),
    }))
    const result = await provider().retrievePayment(PAYMENT_ID)
    expect(result.latestCharge).toMatchObject({
      chargeId: CHARGE_ID, paymentIntentId: PAYMENT_ID, paymentMethod: 'fpx',
    })
    expect(mocks.retrieveCharge).not.toHaveBeenCalled()
  })

  it('preserves processing with no Charge as pending evidence', async () => {
    mocks.retrievePayment.mockResolvedValue(payment({
      status: 'processing', amount_received: 0, latest_charge: null,
    }))
    const result = await provider().retrievePayment(PAYMENT_ID)
    expect(result).toMatchObject({ status: 'processing', amountReceivedSen: 0, latestCharge: null })
    expect(mocks.retrieveCharge).not.toHaveBeenCalled()
  })

  it('preserves partial-refund evidence and does not infer successful full delivery', async () => {
    mocks.retrieveCharge.mockResolvedValue(charge({ amount_refunded: 1, refunded: false }))
    const result = await provider().retrievePayment(PAYMENT_ID)
    expect(result.latestCharge).toMatchObject({ refunded: false, amountRefundedSen: 1 })
  })

  it('does not guess CARD for an unsupported or absent actual method', async () => {
    mocks.retrieveCharge.mockResolvedValue(charge({ payment_method_details: { type: 'unknown_method' } }))
    const result = await provider().retrievePayment(PAYMENT_ID)
    expect(result.latestCharge?.paymentMethod).toBeNull()
  })

  it.each([
    { session: { livemode: true } },
    { payment: { livemode: true } },
    { payment: { id: 'pi_other' } },
    { charge: { livemode: true } },
    { charge: { id: 'ch_other' } },
    { charge: { payment_intent: 'pi_other' } },
  ])('rejects wrong environment or requested object linkage: %j', async (invalid) => {
    mocks.retrieve.mockResolvedValue(session(invalid.session))
    mocks.retrievePayment.mockResolvedValue(payment(invalid.payment))
    mocks.retrieveCharge.mockResolvedValue(charge(invalid.charge))
    const client = provider()
    const operation = invalid.session
      ? client.retrieveCheckout(SESSION_ID)
      : client.retrievePayment(PAYMENT_ID)
    await expect(operation).rejects.toMatchObject({ code: 'PAYMENT_REJECTED', httpStatus: 400 })
  })
})

describe('M8-T03 safe provider failures', () => {
  it.each(['test', 'live'] as const)('supports a mode-matched restricted %s server key', async mode => {
    mocks.create.mockResolvedValue(session({ livemode: mode === 'live' }))
    const key = 'rk_' + mode + '_t03_synthetic_only'
    await createStripePaymentProvider({ secretKey: key, mode }).createCheckout(request)
    expect(mocks.Stripe).toHaveBeenCalledWith(key, expect.any(Object))
  })

  it.each([
    { payment_method_details: { type: 'fpx' } },
    { payment_method_details: { type: 'fpx', fpx: null } },
    { payment_method_details: { type: 'fpx', fpx: { transaction_id: null } } },
    { payment_method_details: { type: 'fpx', fpx: { bank: null, transaction_id: null } } },
    { payment_method_details: { type: 'fpx', fpx: { bank: '', transaction_id: null } } },
    { payment_method_details: { type: 'fpx', fpx: { bank: 'maybank2u', transaction_id: 'bad\nreceipt' } } },
    { statement_descriptor: 'bad\rdescriptor' },
    { statement_descriptor: 'x'.repeat(129) },
  ])('rejects malformed FPX receipt facts without inventing placeholders: %j', async overrides => {
    mocks.retrieveCharge.mockResolvedValue(charge(overrides))
    await expect(provider().retrievePayment(PAYMENT_ID)).rejects.toMatchObject({
      code: 'PAYMENT_REJECTED', httpStatus: 400,
    })
  })

  it('preserves legitimate nullable receipt references and a safe unknown bank code', async () => {
    mocks.retrieveCharge.mockResolvedValue(charge({ statement_descriptor: null,
      payment_method_details: { type: 'fpx', fpx: { bank: 'future_bank', transaction_id: null } },
    }))
    expect((await provider().retrievePayment(PAYMENT_ID)).latestCharge).toMatchObject({
      statementDescriptor: null, fpx: { bankCode: 'future_bank', transactionId: null },
    })
  })

  it.each([
    { type: 'StripeConnectionError', status: 503, code: 'PAYMENT_UNAVAILABLE' },
    { type: 'StripeAPIError', status: 503, code: 'PAYMENT_UNAVAILABLE' },
    { type: 'StripeRateLimitError', status: 503, code: 'PAYMENT_UNAVAILABLE' },
    { type: 'StripeAuthenticationError', status: 503, code: 'PAYMENT_UNAVAILABLE' },
    { type: 'StripeInvalidRequestError', status: 400, code: 'PAYMENT_REJECTED' },
    { type: 'StripeIdempotencyError', status: 400, code: 'PAYMENT_REJECTED' },
    { type: 'UnexpectedProviderError', status: 503, code: 'PAYMENT_UNAVAILABLE' },
  ])('classifies $type without leaking SDK message, raw object, cause, or stack', async ({ type, status, code }) => {
    const raw = { secret: TEST_KEY, payload: PRIVATE_VALUE, url: HOSTED_URL }
    const failure = Object.assign(new Error(PRIVATE_VALUE + ' ' + TEST_KEY), { type, raw })
    mocks.create.mockRejectedValue(failure)
    const caught: unknown = await provider().createCheckout(request).catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(Error)
    expect(caught).toMatchObject({ httpStatus: status, code })
    expect(caught).not.toBe(failure)
    const output = serialized({ caught, logs: loggedText() })
    expect(output).not.toContain(TEST_KEY)
    expect(output).not.toContain(PRIVATE_VALUE)
    expect(output).not.toContain(HOSTED_URL)
  })

  it('sanitizes constructor failures as well as request failures', async () => {
    mocks.Stripe.mockImplementation(function () {
      throw new Error(TEST_KEY + ' ' + PRIVATE_VALUE)
    })
    const caught: unknown = await provider().createCheckout(request).catch((error: unknown) => error)
    expect(caught).toMatchObject({ httpStatus: 503, code: 'PAYMENT_UNAVAILABLE' })
    expect(serialized({ caught, logs: loggedText() })).not.toContain(TEST_KEY)
    expect(serialized({ caught, logs: loggedText() })).not.toContain(PRIVATE_VALUE)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('sanitizes a timeout while reading the nested Charge', async () => {
    mocks.retrieveCharge.mockRejectedValue(Object.assign(new Error(PRIVATE_VALUE), {
      type: 'StripeConnectionError', code: 'ETIMEDOUT',
    }))
    const caught: unknown = await provider().retrievePayment(PAYMENT_ID).catch((error: unknown) => error)
    expect(caught).toMatchObject({ httpStatus: 503, code: 'PAYMENT_UNAVAILABLE' })
    expect(serialized({ caught, logs: loggedText() })).not.toContain(PRIVATE_VALUE)
  })

  it.each(['retrieveCheckout', 'expireCheckout', 'retrievePayment'] as const)(
    'maps a timeout from %s to a safe retryable error',
    async (operation) => {
      const failure = Object.assign(new Error(PRIVATE_VALUE), {
        type: 'StripeConnectionError', code: 'ETIMEDOUT',
      })
      mocks.retrieve.mockRejectedValue(failure)
      mocks.expire.mockRejectedValue(failure)
      mocks.retrievePayment.mockRejectedValue(failure)
      const id = operation === 'retrievePayment' ? PAYMENT_ID : SESSION_ID
      const caught: unknown = await provider()[operation](id).catch((error: unknown) => error)
      expect(caught).toMatchObject({ httpStatus: 503, code: 'PAYMENT_UNAVAILABLE' })
      expect(serialized({ caught, logs: loggedText() })).not.toContain(PRIVATE_VALUE)
    },
  )
})
