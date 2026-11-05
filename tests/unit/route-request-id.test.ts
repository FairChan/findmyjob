import { vi, describe, it, expect } from 'vitest'

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

import { route } from '@/server/route'
import { logger } from '@/server/lib/logger'

describe('route requestId propagation', () => {
  it('includes requestId in error log even when x-request-id header is absent', async () => {
    vi.clearAllMocks()
    const handler = route({ auth: 'public' }, async () => {
      throw new Error('test unhandled')
    })

    const req = new Request('http://localhost/api/test', { method: 'GET' })
    // No x-request-id header

    await handler(req)

    expect(logger.error).toHaveBeenCalledOnce()
    // pino: first arg is the merge object, second is the message
    const ctx = vi.mocked(logger.error).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(typeof ctx.requestId).toBe('string')
    expect((ctx.requestId as string).length).toBeGreaterThan(0)
  })

  it('echoes the x-request-id from the request in the error log', async () => {
    vi.clearAllMocks()
    const handler = route({ auth: 'public' }, async () => {
      throw new Error('test')
    })

    const req = new Request('http://localhost/api/test', {
      method: 'GET',
      headers: { 'x-request-id': 'req-abc-123' },
    })

    await handler(req)

    const ctx = vi.mocked(logger.error).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(ctx.requestId).toBe('req-abc-123')
  })
})
