import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/lib/db-rate-limit', () => ({
  hitBucket: vi.fn(),
}))

vi.mock('@/server/db', () => ({
  db: {
    $executeRaw: vi.fn().mockResolvedValue(1),
  },
}))

const { hitBucket } = await import('@/server/lib/db-rate-limit')
const { db } = await import('@/server/db')
const { checkRateLimit, clearRateLimit } = await import('@/server/lib/rate-limit')

const mockHitBucket = vi.mocked(hitBucket)
const mockExecuteRaw = vi.mocked(db.$executeRaw)

const KEY = 'test:rate-limit'
const OPTS = { windowMs: 1_000, limit: 3 }

function makeResult(count: number, limit: number) {
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: Date.now() + 1_000,
    count,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkRateLimit', () => {
  it('delegates to hitBucket and returns its result', async () => {
    mockHitBucket.mockResolvedValueOnce(makeResult(1, 3))
    const result = await checkRateLimit(KEY, OPTS)
    expect(mockHitBucket).toHaveBeenCalledWith(KEY, OPTS)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
    expect(result.count).toBe(1)
  })

  it('returns blocked result when count exceeds limit', async () => {
    mockHitBucket.mockResolvedValueOnce(makeResult(4, 3))
    const result = await checkRateLimit(KEY, OPTS)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('provides resetAt in the result', async () => {
    const future = Date.now() + 1_000
    mockHitBucket.mockResolvedValueOnce({ allowed: true, remaining: 2, resetAt: future, count: 1 })
    const result = await checkRateLimit(KEY, OPTS)
    expect(result.resetAt).toBe(future)
  })
})

describe('clearRateLimit', () => {
  it('calls db.$executeRaw to delete the key', async () => {
    await clearRateLimit(KEY)
    expect(mockExecuteRaw).toHaveBeenCalledOnce()
    // The first arg is a Prisma.Sql template
    const [sql] = mockExecuteRaw.mock.calls[0]
    expect((sql as { strings: string[] }).strings.join('')).toContain('DELETE FROM "RateLimitBucket"')
  })
})
