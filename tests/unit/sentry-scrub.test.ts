import { describe, it, expect } from 'vitest'
import type { ErrorEvent } from '@sentry/node'
import { scrubEvent } from '@/lib/sentry-options'

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
})
