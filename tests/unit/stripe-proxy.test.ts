import { describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }))

const { default: middleware } = await import('@/proxy')

describe('Stripe webhook proxy exception', () => {
  it('allows the exact signed-webhook endpoint to reach its own verifier without a browser session', async () => {
    const response = await middleware(new NextRequest(
      'https://app.example.test/api/payments/stripe/webhook',
      { method: 'POST', body: 'synthetic raw event' },
    ))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it.each([
    '/api/payments/stripe',
    '/api/payments/stripe/webhook/child',
    '/api/payments/stripe/webhooks',
    '/api/payments/stripe/webhook-other',
  ])('keeps anonymous access denied for adjacent path %s', async path => {
    const response = await middleware(new NextRequest(
      new URL(path, 'https://app.example.test'),
      { method: 'POST', body: '{}' },
    ))
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})
