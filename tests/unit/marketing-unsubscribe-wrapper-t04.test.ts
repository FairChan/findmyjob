import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ unsubscribe: vi.fn(), limit: vi.fn(), error: vi.fn() }))
vi.mock('@/server/services/marketing-consent', () => ({ unsubscribeMarketing: io.unsubscribe }))
vi.mock('@/server/lib/rate-limit', () => ({ checkRateLimit: io.limit }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: io.error } }))
import { GET, POST } from '@/app/api/marketing/unsubscribe/route'

beforeEach(() => { vi.resetAllMocks(); io.limit.mockResolvedValue({ allowed: true }) })
const form = (body: string, headers: Record<string, string> = {}) => new Request('https://app.example.test/api/marketing/unsubscribe', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '192.0.2.44', ...headers }, body,
})
function safeHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  expect(response.headers.get('content-security-policy')).toContain("form-action 'self'")
}
describe('T04 unsubscribe uses the shared public route boundary', () => {
  it('accepts the wrapper standard Request and keeps GET inert', async () => {
    const response = await GET(new Request('https://app.example.test/api/marketing/unsubscribe?token=synthetic'))
    expect(response.status).toBe(200)
    safeHeaders(response)
    expect(await response.text()).toContain('name="token" value="synthetic"')
    expect(io.unsubscribe).not.toHaveBeenCalled()
  })
  it.each<Record<string, string>>([{}, { origin: 'https://external.example.test' }])('authorizes withdrawal only by the signed body, without login or origin: %#', async headers => {
    const response = await POST(form('token=synthetic', headers))
    expect(response.status).toBe(200)
    safeHeaders(response)
    expect(io.unsubscribe).toHaveBeenCalledExactlyOnceWith('synthetic')
    expect(await response.text()).not.toContain('synthetic')
    expect(io.error).not.toHaveBeenCalled()
  })
  it('preserves bounded parsing and extra-authority rejection through the wrapper', async () => {
    for (const body of ['token=x&userId=other', 'token=x&granted=true', 'token=' + 'x'.repeat(2049)]) {
      const response = await POST(form(body))
      expect(response.status).toBe(400)
      safeHeaders(response)
    }
    expect(io.unsubscribe).not.toHaveBeenCalled()
  })
  it('retains rate limiting before mutation and common response headers', async () => {
    io.limit.mockResolvedValue({ allowed: false })
    const response = await POST(form('token=PRIVATE_TOKEN'))
    expect(response.status).toBe(429)
    safeHeaders(response)
    expect(io.unsubscribe).not.toHaveBeenCalled()
    expect(JSON.stringify(io.limit.mock.calls)).not.toMatch(/PRIVATE_TOKEN|192\.0\.2\.44/)
  })
})
