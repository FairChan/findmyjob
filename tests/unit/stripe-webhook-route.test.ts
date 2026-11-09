/**
 * M8-T03 raw webhook boundary with real stripe@23.1.0 signature helpers.
 *
 * Real local Stripe signing/verification helpers and the real route wrapper.
 * The complete order-processing service is mocked; no Stripe HTTP client,
 * database, credentials, external account, or network request is required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { AppError } from '@/server/errors'

const key = vi.hoisted(() => crypto.randomUUID())
const mocks = vi.hoisted(() => ({
  handleStripeWebhook: vi.fn(),
  requireUser: vi.fn(),
  getSetting: vi.fn(),
  env: {
    APP_URL: 'https://payments.example.test',
    APP_ENV: 'development',
    STRIPE_SECRET_KEY: undefined as string | undefined,
    STRIPE_WEBHOOK_SECRET: key as string | undefined,
  },
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('stripe', async () => {
  const actual = await vi.importActual<typeof import('stripe')>('stripe')
  // Keep real local crypto; prohibit constructing any HTTP-capable SDK client.
  const StripeWithoutHttp = Object.assign(
    vi.fn(function () {
      throw new Error('Stripe HTTP client is forbidden in the raw route unit test')
    }),
    { webhooks: actual.default.webhooks },
  )
  return { ...actual, default: StripeWithoutHttp, Stripe: StripeWithoutHttp }
})

vi.mock('@/env', () => ({ env: mocks.env }))
vi.mock('@/server/services/stripe-payments', () => ({
  handleStripeWebhook: mocks.handleStripeWebhook,
}))
vi.mock('@/server/authz', () => ({ requireUser: mocks.requireUser }))
vi.mock('@/server/services/settings', () => ({ getSetting: mocks.getSetting }))
vi.mock('@/server/lib/logger', () => ({ logger: mocks.logger }))

import { POST, runtime } from '@/app/api/payments/stripe/webhook/route'

const SECRET = key
const SENTINEL = 'SYNTHETIC_PRIVATE_EVENT_VALUE'
const event = {
  id: 'evt_t03_synthetic_completed',
  object: 'event',
  type: 'checkout.session.completed',
  api_version: '2026-10-28.endive',
  created: 1_794_268_800,
  livemode: false,
  data: {
    object: {
      id: 'cs_test_t03_synthetic',
      object: 'checkout.session',
      mode: 'payment',
      status: 'complete',
      payment_status: 'paid',
      amount_total: 149950,
      currency: 'myr',
      payment_intent: 'pi_t03_synthetic',
      client_reference_id: 'order-t03-synthetic',
      metadata: { orderId: 'order-t03-synthetic', companyId: 'company-t03-synthetic', testSentinel: SENTINEL },
      livemode: false,
    },
  },
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
}
// Deliberate whitespace, CRLF, and Unicode. parse/stringify changes signed bytes.
const RAW = ' \r\n' + JSON.stringify({ ...event, testUnicode: '合成事件' }, null, 2) + '\r\n'

function sign(payload = RAW, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp })
}

function request(payload: string, signature?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature !== undefined) headers['stripe-signature'] = signature
  // Stripe server delivery has neither browser Origin nor a session cookie.
  return new Request('https://payments.example.test/api/payments/stripe/webhook', {
    method: 'POST', headers, body: payload,
  })
}

function loggedText() {
  return JSON.stringify(
    Object.values(mocks.logger).flatMap((mock) => mock.mock.calls),
    (_key, value: unknown) => value instanceof Error
      ? { message: value.message, stack: value.stack }
      : value,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.env.STRIPE_SECRET_KEY = undefined
  mocks.env.STRIPE_WEBHOOK_SECRET = SECRET
  mocks.handleStripeWebhook.mockReset().mockResolvedValue(undefined)
  mocks.requireUser.mockReset().mockRejectedValue(new Error('No browser session'))
  // Disabling new sales must not make a valid in-flight webhook disappear.
  mocks.getSetting.mockReset().mockResolvedValue(false)
  vi.stubEnv('APP_URL', mocks.env.APP_URL)
})
afterEach(() => vi.unstubAllEnvs())

describe('M8-T03 raw Stripe webhook route', () => {
  it('uses Node runtime and forwards one verified raw event without Origin, session, or API key', async () => {
    const req = request(RAW, sign())
    const readText = vi.spyOn(req, 'text')
    const readJson = vi.spyOn(req, 'json')
    const response = await POST(req)

    expect(runtime).toBe('nodejs')
    expect(response.status).toBe(200)
    expect(readText).toHaveBeenCalledOnce()
    expect(readJson).not.toHaveBeenCalled()
    expect(mocks.handleStripeWebhook).toHaveBeenCalledExactlyOnceWith(JSON.parse(RAW))
    expect(mocks.requireUser).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
  })

  it.each(['missing', 'malformed', 'wrong-secret', 'body-changed', 'expired'] as const)(
    'rejects %s signatures before the order service and without logging the signed content',
    async (variant) => {
      let payload = RAW
      let signature: string | undefined = sign()
      if (variant === 'missing') signature = undefined
      if (variant === 'malformed') signature = 't=not-a-timestamp,v1=invalid'
      if (variant === 'wrong-secret') signature = sign(RAW, crypto.randomUUID())
      if (variant === 'body-changed') payload = RAW + ' '
      if (variant === 'expired') signature = sign(RAW, SECRET, Math.floor(Date.now() / 1000) - 600)
      const response = await POST(request(payload, signature))
      const responseText = await response.text()

      expect(response.status).toBe(400)
      expect(mocks.handleStripeWebhook).not.toHaveBeenCalled()
      for (const text of [responseText, loggedText()]) {
        expect(text).not.toContain(SECRET)
        expect(text).not.toContain(SENTINEL)
        expect(text).not.toContain(RAW)
      }
      expect(responseText).not.toContain(signature ?? 'not-a-signature-sentinel')
      expect(loggedText()).not.toContain(signature ?? 'not-a-signature-sentinel')
    },
  )

  it('rejects a correctly signed malformed JSON body as a controlled 400', async () => {
    const malformed = '{ "id": "evt_t03_broken", '
    const response = await POST(request(malformed, sign(malformed)))
    expect(response.status).toBe(400)
    expect(mocks.handleStripeWebhook).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain(malformed)
  })

  it('does not deduplicate delivery in process memory before the durable order service', async () => {
    const signature = sign()
    const first = await POST(request(RAW, signature))
    const second = await POST(request(RAW, signature))
    expect([first.status, second.status]).toEqual([200, 200])
    expect(mocks.handleStripeWebhook).toHaveBeenCalledTimes(2)
    expect(mocks.handleStripeWebhook.mock.calls.map(([received]) => received.id))
      .toEqual([event.id, event.id])
  })

  it('returns a retryable status when processing fails and forwards a later retry again', async () => {
    mocks.handleStripeWebhook.mockRejectedValueOnce(new Error('synthetic transaction failure'))
    const failed = await POST(request(RAW, sign()))
    expect(failed.status).toBe(503)

    const retried = await POST(request(RAW, sign()))
    expect(retried.status).toBe(200)
    expect(mocks.handleStripeWebhook).toHaveBeenCalledTimes(2)
  })

  it('sanitizes processing errors before the shared wrapper can log their message', async () => {
    const signature = sign()
    mocks.handleStripeWebhook.mockRejectedValueOnce(
      new Error('synthetic failure ' + SENTINEL + ' ' + SECRET + ' ' + signature + ' ' + RAW),
    )
    const response = await POST(request(RAW, signature))
    expect(response.status).toBe(503)
    for (const text of [await response.text(), loggedText()]) {
      expect(text).not.toContain(SENTINEL)
      expect(text).not.toContain(SECRET)
      expect(text).not.toContain(signature)
      expect(text).not.toContain(RAW)
    }
  })

  it('keeps a permanent payment rejection at 400 while removing its private message', async () => {
    mocks.handleStripeWebhook.mockRejectedValueOnce(new AppError(SENTINEL, 'PAYMENT_REJECTED', 400))
    const response = await POST(request(RAW, sign()))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, code: 'PAYMENT_REJECTED' })
    expect(loggedText()).not.toContain(SENTINEL)
  })

  it('fails closed without the webhook secret without invoking processing', async () => {
    mocks.env.STRIPE_WEBHOOK_SECRET = undefined
    vi.resetModules()
    const { POST: unconfiguredPost } = await import('@/app/api/payments/stripe/webhook/route')
    const response = await unconfiguredPost(request(RAW, sign()))
    expect(response.status).toBe(503)
    expect(mocks.handleStripeWebhook).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain(SECRET)
  })
})
