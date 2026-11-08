/**
 * route() rejects state-changing requests from a foreign or missing Origin. skipOriginCheck exists
 * for /api/csp-report only and must have no effect unless auth is 'public'.
 */
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/server/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/server/authz', () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: 'u1' }),
  requireStudent: vi.fn().mockResolvedValue({ userId: 'u1' }),
  requireAdmin: vi.fn().mockResolvedValue({ userId: 'u1' }),
}))

import { route } from '@/server/route'

const post = (origin?: string) =>
  new Request('http://localhost:3000/api/x', {
    method: 'POST',
    headers: origin ? { origin } : {},
    body: '{}',
  })

describe('route() origin check', () => {
  it('rejects a POST without Origin by default (403, handler not called)', async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }))
    const res = await route({ auth: 'public' }, handler)(post())
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('public + skipOriginCheck accepts a POST without Origin', async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }))
    const res = await route({ auth: 'public', skipOriginCheck: true }, handler)(post())
    expect(res.status).toBe(204)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('skipOriginCheck is ignored for authenticated routes', async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }))
    const res = await route({ auth: 'user', skipOriginCheck: true }, handler)(post('https://evil.example'))
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })
})
