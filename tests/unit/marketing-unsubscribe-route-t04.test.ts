import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const io = vi.hoisted(() => ({ unsubscribe: vi.fn(), limit: vi.fn() }))
vi.mock('@/server/services/marketing-consent', () => ({ unsubscribeMarketing: io.unsubscribe }))
vi.mock('@/server/lib/rate-limit', () => ({ checkRateLimit: io.limit }))
import { GET, POST } from '@/app/api/marketing/unsubscribe/route'
beforeEach(() => { vi.resetAllMocks(); io.limit.mockResolvedValue({ allowed: true }) })
const request = (body: string) => new NextRequest('https://app.example.test/api/marketing/unsubscribe', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '192.0.2.5' }, body,
})
describe('T04 signed withdrawal request limits', () => {
  it('GET confirmation is inert and escapes untrusted token markup', async () => {
    const response = await GET(new NextRequest('https://app.example.test/api/marketing/unsubscribe?token=%22%3E%3Cscript%3E'))
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('<script>')
    expect(io.unsubscribe).not.toHaveBeenCalled()
  })
  it('rate limits before any withdrawal mutation without putting tokens or raw IP in bucket keys', async () => {
    io.limit.mockResolvedValue({ allowed: false })
    const response = await POST(request('token=PRIVATE_TOKEN'))
    expect(response.status).toBe(429)
    expect(io.unsubscribe).not.toHaveBeenCalled()
    expect(JSON.stringify(io.limit.mock.calls)).not.toMatch(/PRIVATE_TOKEN|192\.0\.2\.5/)
  })
  it('rejects an oversized streaming form and any extra authority fields', async () => {
    expect((await POST(request('token=' + 'x'.repeat(2049)))).status).toBe(400)
    expect((await POST(request('token=synthetic&granted=true'))).status).toBe(400)
    expect(io.unsubscribe).not.toHaveBeenCalled()
  })
  it('accepts only the token and preserves no-store/no-referrer on completion', async () => {
    const response = await POST(request('token=synthetic'))
    expect(io.unsubscribe).toHaveBeenCalledExactlyOnceWith('synthetic')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.text()).not.toContain('synthetic')
  })
})
