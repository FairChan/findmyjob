import { describe, it, expect } from 'vitest'
import type { ErrorEvent, Breadcrumb } from '@sentry/node'
import { scrubEvent, beforeBreadcrumb } from '@/lib/sentry-options'

function makeEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    event_id: 'test-event-id',
    type: undefined,
    ...overrides,
  } as ErrorEvent
}

describe('scrubEvent', () => {
  it('removes cookies from request', () => {
    const event = makeEvent({
      request: { url: 'http://localhost/api/test', cookies: { session: 'abc123', token: 'xyz' } },
    })
    const result = scrubEvent(event)
    expect(result?.request?.cookies).toBeUndefined()
  })

  it('removes query_string from request', () => {
    const event = makeEvent({
      request: { url: 'http://localhost/api/test', query_string: 'token=abc' },
    })
    const result = scrubEvent(event)
    expect(result?.request?.query_string).toBeUndefined()
  })

  it('removes query string from URL', () => {
    const event = makeEvent({
      request: { url: 'http://localhost/api/test?token=abc&foo=bar' },
    })
    const result = scrubEvent(event)
    expect(result?.request?.url).toBe('/api/test')
    expect(result?.request?.url).not.toContain('token=abc')
  })

  it('removes data field from request', () => {
    const event = makeEvent({
      request: { url: 'http://localhost/api/test', data: { password: 'secret' } },
    })
    const result = scrubEvent(event)
    expect(result?.request?.data).toBeUndefined()
  })

  it('keeps only user-agent header (preserves User-Agent)', () => {
    const event = makeEvent({
      request: {
        url: 'http://localhost/api/test',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Authorization': 'Bearer secret-token',
          'X-Custom-Header': 'value',
        },
      },
    })
    const result = scrubEvent(event)
    expect(result?.request?.headers).toEqual({ 'User-Agent': 'Mozilla/5.0' })
  })

  it('keeps only user-agent header (lowercase user-agent)', () => {
    const event = makeEvent({
      request: {
        url: 'http://localhost/api/test',
        headers: { 'user-agent': 'curl/7.0', 'cookie': 'session=abc' },
      },
    })
    const result = scrubEvent(event)
    expect(result?.request?.headers).toEqual({ 'User-Agent': 'curl/7.0' })
  })

  it('removes all headers when no user-agent present', () => {
    const event = makeEvent({
      request: {
        url: 'http://localhost/api/test',
        headers: { 'Authorization': 'Bearer token', 'X-Request-Id': 'abc' },
      },
    })
    const result = scrubEvent(event)
    expect(result?.request?.headers).toEqual({})
  })

  it('removes user field', () => {
    const event = makeEvent({
      user: { id: 'user-123', email: 'test@example.test', username: 'testuser' },
    })
    const result = scrubEvent(event)
    expect(result?.user).toBeUndefined()
  })

  it('scrubs sentinel phone from message', () => {
    const event = makeEvent({ message: 'User called +60 12-000 0420 for support' })
    const result = scrubEvent(event)
    expect(result?.message).not.toContain('+60 12-000 0420')
  })

  it('scrubs sentinel email from message', () => {
    const event = makeEvent({ message: 'Error for leak-sentinel@example.test account' })
    const result = scrubEvent(event)
    expect(result?.message).not.toContain('leak-sentinel@example.test')
  })

  it('handles event with no request', () => {
    const event = makeEvent({ message: 'No request context' })
    const result = scrubEvent(event)
    expect(result).not.toBeNull()
    expect(result?.request).toBeUndefined()
  })

  it('handles event with no message', () => {
    const event = makeEvent({ request: { url: 'http://localhost/api/test' } })
    const result = scrubEvent(event)
    expect(result).not.toBeNull()
    expect(result?.message).toBeUndefined()
  })

  it('sanitizes ID segments in request URL', () => {
    const event = makeEvent({
      request: { url: 'http://localhost/users/cm9abc12345678901234/profile' },
    })
    const result = scrubEvent(event)
    expect(result?.request?.url).toBe('/users/[id]/profile')
    expect(result?.request?.url).not.toContain('cm9abc12345678901234')
  })

  it('sanitizes numeric ID segments in request URL', () => {
    const event = makeEvent({
      request: { url: 'http://localhost/jobs/42/apply' },
    })
    const result = scrubEvent(event)
    expect(result?.request?.url).toBe('/jobs/[id]/apply')
  })

  it('sanitizes UUID segments in request URL', () => {
    const event = makeEvent({
      request: { url: 'http://localhost/items/550e8400-e29b-41d4-a716-446655440000/edit' },
    })
    const result = scrubEvent(event)
    expect(result?.request?.url).toBe('/items/[id]/edit')
  })

  it('strips query string from contexts.nextjs.request_path', () => {
    const event = makeEvent({
      contexts: { nextjs: { request_path: '/api/jobs?email=leak@example.test' } },
    })
    const result = scrubEvent(event)
    const path = (result?.contexts?.nextjs as Record<string, unknown>)?.['request_path']
    expect(path).toBe('/api/jobs')
    expect(String(path)).not.toContain('email')
    expect(String(path)).not.toContain('?')
  })

  it('sanitizes ID segments in contexts.nextjs.request_path', () => {
    const event = makeEvent({
      contexts: { nextjs: { request_path: '/users/cm9abc12345678901234?code=123456' } },
    })
    const result = scrubEvent(event)
    const path = (result?.contexts?.nextjs as Record<string, unknown>)?.['request_path']
    expect(path).toBe('/users/[id]')
  })

  it('redacts sentinel values in exception.values[].value', () => {
    const event = makeEvent({
      exception: {
        values: [
          { type: 'Error', value: 'Failed for leak-sentinel@example.test' },
          { type: 'Error', value: 'Phone: +60 12-000 0420' },
        ],
      },
    })
    const result = scrubEvent(event)
    const values = result?.exception?.values ?? []
    expect(values[0]?.value).not.toContain('leak-sentinel@example.test')
    expect(values[1]?.value).not.toContain('+60 12-000 0420')
  })

  it('removes PII keys from extra', () => {
    const event = makeEvent({
      extra: { email: 'leak-sentinel@example.test', companyId: 'c-123' },
    })
    const result = scrubEvent(event)
    expect(result?.extra).not.toHaveProperty('email')
    expect(result?.extra).toHaveProperty('companyId', 'c-123')
  })

  it('redacts sentinel string values in extra', () => {
    const event = makeEvent({
      extra: { description: 'Contact: leak-sentinel@example.test for info' },
    })
    const result = scrubEvent(event)
    expect(JSON.stringify(result?.extra ?? {})).not.toContain('leak-sentinel@example.test')
  })

  it('no sentinel values survive across all event fields', () => {
    const EMAIL = 'leak-sentinel@example.test'
    const PHONE = '+60 12-000 0420'
    const QUERY_EMAIL = '?email=leak-sentinel@example.test'
    const CODE_QUERY = '?code=123456'
    const event = makeEvent({
      request: { url: `http://localhost/api/test${QUERY_EMAIL}` },
      message: `Error for ${EMAIL}`,
      exception: { values: [{ type: 'Error', value: `Phone ${PHONE}` }] },
      extra: { email: EMAIL, note: `call ${PHONE}` },
      contexts: { nextjs: { request_path: `/api/jobs${CODE_QUERY}` } },
    })
    const scrubbed = scrubEvent(event)
    const json = JSON.stringify(scrubbed)
    expect(json).not.toContain(EMAIL)
    expect(json).not.toContain(PHONE)
    expect(json).not.toContain('?')
  })
})

describe('beforeBreadcrumb', () => {
  function makeBreadcrumb(overrides: Partial<Breadcrumb> = {}): Breadcrumb {
    return { timestamp: 0, ...overrides }
  }

  it('strips query string from http breadcrumb URL', () => {
    const bc = makeBreadcrumb({
      type: 'http',
      data: { url: 'http://localhost/api/jobs?email=leak-sentinel@example.test', 'http.query': '?email=...' },
    })
    const result = beforeBreadcrumb(bc)
    expect(result?.data?.['url']).toBe('/api/jobs')
    expect(result?.data?.['url']).not.toContain('?')
    expect(result?.data?.['http.query']).toBeUndefined()
  })

  it('strips query string from fetch category breadcrumb', () => {
    const bc = makeBreadcrumb({
      category: 'fetch',
      data: { url: '/api/profile?code=123456' },
    })
    const result = beforeBreadcrumb(bc)
    expect(result?.data?.['url']).toBe('/api/profile')
    expect(result?.data?.['url']).not.toContain('?')
  })

  it('strips query string from navigation breadcrumb from/to', () => {
    const bc = makeBreadcrumb({
      category: 'navigation',
      data: { from: '/page?email=leak-sentinel@example.test', to: '/dashboard?code=abc' },
    })
    const result = beforeBreadcrumb(bc)
    expect(result?.data?.['from']).toBe('/page')
    expect(result?.data?.['to']).toBe('/dashboard')
    expect(JSON.stringify(result?.data ?? {})).not.toContain('?')
  })

  it('redacts PII from console breadcrumb message', () => {
    const bc = makeBreadcrumb({
      category: 'console',
      message: 'Error for leak-sentinel@example.test phone +60 12-000 0420',
    })
    const result = beforeBreadcrumb(bc)
    expect(result?.message).not.toContain('leak-sentinel@example.test')
    expect(result?.message).not.toContain('+60 12-000 0420')
  })

  it('passes through unrelated breadcrumbs unchanged', () => {
    const bc = makeBreadcrumb({ category: 'ui.click', message: 'button clicked' })
    const result = beforeBreadcrumb(bc)
    expect(result?.message).toBe('button clicked')
  })
})
