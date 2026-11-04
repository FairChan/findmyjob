import { vi, describe, it, expect, beforeEach } from 'vitest'

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
