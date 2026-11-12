import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ unsubscribe: vi.fn(), limit: vi.fn() }))
vi.mock('@/server/services/marketing-consent', () => ({ unsubscribeMarketing: io.unsubscribe }))
vi.mock('@/server/lib/rate-limit', () => ({ checkRateLimit: io.limit }))
import { GET, POST } from '@/app/api/marketing/unsubscribe/route'

beforeEach(() => { vi.resetAllMocks(); io.limit.mockResolvedValue({ allowed: true }) })
function documentSemantics(html: string) {
  expect(html).toMatch(/<html\s+lang="en"/)
  expect(html).toMatch(/<title>[^<]*Unsubscribe[^<]*退订[^<]*<\/title>/)
  expect(html).toContain('name="viewport"')
  expect(html).toMatch(/<main[\s>]/)
  expect(html).toMatch(/<h1[\s>]/)
  expect(html).toContain('lang="zh-Hans"')
}
describe('T04 anonymous unsubscribe accessible documents', () => {
  it('labels both languages and exposes a keyboard confirmation without mutating on GET', async () => {
    const response = await GET(new Request('https://app.example.test/api/marketing/unsubscribe?token=synthetic'))
    const html = await response.text()
    documentSemantics(html)
    expect(response.status).toBe(200)
    expect(html).toMatch(/<button[^>]*autofocus/)
    expect(html).toContain('name="token" value="synthetic"')
    expect(io.unsubscribe).not.toHaveBeenCalled()
  })
  it('returns a focusable polite completion without disclosing the supplied token', async () => {
    const response = await POST(new Request('https://app.example.test/api/marketing/unsubscribe', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=synthetic',
    }))
    const html = await response.text()
    documentSemantics(html)
    expect(response.status).toBe(200)
    expect(html).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*tabindex="-1"[^>]*autofocus/)
    expect(html).toContain('Your weekly email preference has been processed.')
    expect(html).toContain('每周邮件偏好已处理。')
    expect(html).not.toContain('synthetic')
    expect(io.unsubscribe).toHaveBeenCalledExactlyOnceWith('synthetic')
  })
})
