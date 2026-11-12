import { describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }))
vi.mock('@/env', () => ({ env: { APP_ENV: 'test' } }))
import middleware from '@/proxy'
describe('T04 exact anonymous unsubscribe proxy exception', () => {
  it.each(['GET', 'POST'])('allows %s at the exact signed withdrawal route without a session', async method => {
    const response = await middleware(new NextRequest('https://app.example.test/api/marketing/unsubscribe', { method }))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })
  it.each(['/api/marketing/preferences', '/api/marketing/unsubscribe/other', '/api/marketing/unsubscribe-extra'])('keeps %s authenticated', async path => {
    expect((await middleware(new NextRequest('https://app.example.test' + path))).status).toBe(401)
  })
})
