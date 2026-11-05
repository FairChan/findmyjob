import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import type { ErrorEvent, Breadcrumb } from '@sentry/node'
import { scrubEvent, beforeBreadcrumb } from '@/lib/sentry-options'

vi.mock('@/server/lib/logger', () => ({
  pinoOptions: {},
  logger: {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}))

import { alert } from '@/server/lib/alert'
import { logger } from '@/server/lib/logger'

describe('alert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls logger.error (level 50) for wallet.mismatch', () => {
    alert('wallet.mismatch')
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it('includes the code in the log message (second arg in pino API)', () => {
    alert('wallet.mismatch')
    // pino: logger.error(obj, msg) — message is second arg
    const msg = vi.mocked(logger.error).mock.calls[0][1] as unknown as string
    expect(msg).toContain('wallet.mismatch')
  })

  it('includes extra context when provided', () => {
    alert('wallet.mismatch', { companyId: 'c-123', expected: 100, actual: 90 })
    // pino: first arg is the merge object
    const ctx = vi.mocked(logger.error).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(ctx).toMatchObject({ companyId: 'c-123', expected: 100, actual: 90 })
  })

  it('includes alert code in context object', () => {
    alert('wallet.mismatch')
    const ctx = vi.mocked(logger.error).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(ctx).toMatchObject({ alert: 'wallet.mismatch' })
  })
})

describe('alert Sentry transport integration', () => {
  // Collected envelopes from the custom transport installed in beforeAll
  const sentEnvelopes: unknown[] = []

  beforeAll(async () => {
    const { init } = await import('@sentry/node')
    init({
      dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
      transport: (() => ({
        send: async (envelope: unknown) => {
          sentEnvelopes.push(envelope)
          return {}
        },
        flush: async () => true,
      })) as any,
      beforeSend: scrubEvent,
    })
  })

  beforeEach(() => {
    sentEnvelopes.length = 0
  })

  it('alert() delivers at least one event to Sentry', async () => {
    const { flush } = await import('@sentry/node')
    alert('test.delivery')
    await flush(2000)
    expect(sentEnvelopes.length).toBeGreaterThan(0)
  })

  it('alert() strips PII email from extra before it reaches Sentry', async () => {
    const { flush } = await import('@sentry/node')
    alert('test.pii', { email: 'noemail@noemail.test', amount: 42 })
    await flush(2000)
    expect(sentEnvelopes.length).toBeGreaterThan(0)
    // Envelope shape: [header, [[itemHeader, eventBody]]]
    const envelope = sentEnvelopes[0] as [unknown, Array<[unknown, Record<string, unknown>]>]
    const eventBody = envelope[1][0][1]
    // scrubEvent must remove PII keys from extra
    const extra = eventBody['extra'] as Record<string, unknown>
    expect(extra).not.toHaveProperty('email')
    // non-PII context survives
    expect(extra).toMatchObject({ amount: 42 })
  })
})

describe('scrubEvent – extra arrays', () => {
  it('scrubs PII string inside an array value in extra', () => {
    const event: ErrorEvent = {
      event_id: 'arr1',
      type: undefined,
      extra: { tags: ['safe', 'user@example.test', 'also-safe'] },
    } as ErrorEvent
    const result = scrubEvent(event)
    const tags = result?.extra?.['tags'] as string[]
    expect(Array.isArray(tags)).toBe(true)
    expect(tags.join(',')).not.toContain('user@example.test')
    expect(tags).toContain('safe')
    expect(tags).toContain('also-safe')
  })

  it('scrubs PII string inside nested object inside array', () => {
    const event: ErrorEvent = {
      event_id: 'arr2',
      type: undefined,
      extra: { items: [{ label: 'ok', contact: 'spy@example.test' }] },
    } as ErrorEvent
    const result = scrubEvent(event)
    const items = result?.extra?.['items'] as Array<Record<string, unknown>>
    expect(JSON.stringify(items)).not.toContain('spy@example.test')
    expect(items[0]?.['label']).toBe('ok')
  })
})

describe('scrubEvent – exception.value query strings', () => {
  it('strips ?token=... from exception value', () => {
    const event: ErrorEvent = {
      event_id: 'qs1',
      type: undefined,
      exception: {
        values: [{ type: 'Error', value: 'Request failed: /api/reset?token=abc123&uid=42' }],
      },
    } as unknown as ErrorEvent
    const result = scrubEvent(event)
    const val = result?.exception?.values?.[0]?.value ?? ''
    expect(val).not.toContain('?token=abc123')
    expect(val).toContain('/api/reset')
  })
})

describe('beforeBreadcrumb – console category', () => {
  it('returns null for a console breadcrumb (drops it entirely)', () => {
    const bc: Breadcrumb = { type: 'default', category: 'console', message: 'some log' }
    expect(beforeBreadcrumb(bc)).toBeNull()
  })

  it('returns null even when data.arguments carries sensitive values', () => {
    const bc: Breadcrumb = {
      type: 'default',
      category: 'console',
      message: 'err msg',
      data: { arguments: ['leak-sentinel@example.test', 'other'] },
    }
    const result = beforeBreadcrumb(bc)
    expect(result).toBeNull()
    // double-check the sentinel never surfaces
    if (result !== null) {
      expect(JSON.stringify(result)).not.toContain('leak-sentinel@example.test')
    }
  })
})

// End-to-end envelope test: uses the FULL production sentryOptions (beforeSend, beforeBreadcrumb,
// dataCollection, tracesSampler all from production config) so any regression in those hooks
// causes this suite to fail.
describe('alert Sentry integration – full production sentryOptions', () => {
  const collected: unknown[] = []

  beforeAll(async () => {
    const sentry = await import('@sentry/node')
    const { sentryOptions } = await import('@/lib/sentry-options')

    sentry.init({
      ...sentryOptions,
      dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
      transport: (() => ({
        send: async (envelope: unknown) => {
          collected.push(envelope)
          return {}
        },
        flush: async () => true,
      })) as any,
    })

    // Console breadcrumb carrying the sentinel – beforeBreadcrumb from sentryOptions must drop it
    sentry.addBreadcrumb({
      type: 'default',
      category: 'console',
      message: 'leak-sentinel@example.test',
      data: { arguments: ['leak-sentinel@example.test'] },
    })

    // alert() with PII in array and nested object – scrubEvent from sentryOptions must remove them
    alert('x', {
      list: ['leak-sentinel@example.test', '+60 12-000 0420'],
      nested: { token: 'abc' },
    })

    // exception value with PII in query string – scrubEvent must strip the query string
    sentry.captureException(
      new Error('failed for /api/x?token=abc&email=leak-sentinel@example.test'),
    )

    await sentry.flush(3000)
  })

  afterAll(async () => {
    const { close } = await import('@sentry/node')
    await close(2000).catch(() => {})
  })

  it('receives at least one event (transport is wired via sentryOptions)', () => {
    expect(collected.length).toBeGreaterThan(0)
  })

  it('no sentinel email in any envelope – console breadcrumb dropped + extra scrubbed', () => {
    const dump = JSON.stringify(collected)
    expect(dump).not.toContain('leak-sentinel@example.test')
  })

  it('no phone PII in any envelope – array element inside extra scrubbed', () => {
    const dump = JSON.stringify(collected)
    expect(dump).not.toContain('+60 12-000 0420')
  })

  it('no raw query-string params in any envelope – exception.value stripped', () => {
    const dump = JSON.stringify(collected)
    expect(dump).not.toContain('token=abc')
    expect(dump).not.toContain('?email=')
  })
})
