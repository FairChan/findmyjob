import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock db module
vi.mock('@/server/db', () => ({
  db: {
    $queryRaw: vi.fn(),
  },
}))

const { hitBucket } = await import('@/server/lib/db-rate-limit')
const { db } = await import('@/server/db')

const mockQueryRaw = vi.mocked(db.$queryRaw)

const KEY = 'test:key'
const OPTS = { windowMs: 60_000, limit: 5 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hitBucket', () => {
  it('allows when count is within the limit', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ count: BigInt(1) }])
    const result = await hitBucket(KEY, OPTS)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('allows at the exact limit boundary', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ count: BigInt(5) }])
    const result = await hitBucket(KEY, OPTS)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(0)
  })

  it('blocks when count exceeds the limit', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ count: BigInt(6) }])
    const result = await hitBucket(KEY, OPTS)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('returns a resetAt in the future aligned to window boundaries', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ count: BigInt(1) }])
    const before = Date.now()
    const result = await hitBucket(KEY, OPTS)
    expect(result.resetAt).toBeGreaterThanOrEqual(before)
    // resetAt must be a multiple of windowMs
    expect(result.resetAt % OPTS.windowMs).toBe(0)
  })

  it('issues the INSERT ON CONFLICT query with parameterised values', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ count: BigInt(1) }])
    await hitBucket(KEY, OPTS)
    expect(mockQueryRaw).toHaveBeenCalledOnce()
    // The first argument is a Prisma.Sql template — verify it was called
    const [sql] = mockQueryRaw.mock.calls[0]
    // Prisma.sql produces an object with a `strings` array
    expect((sql as { strings: string[] }).strings.join('')).toContain('ON CONFLICT')
  })

  it('returns the raw count from the DB', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ count: BigInt(3) }])
    const result = await hitBucket(KEY, OPTS)
    expect(result.count).toBe(3)
  })

  it('SQL uses double-quoted column names', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ count: BigInt(1) }])
    await hitBucket(KEY, OPTS)
    const [sql] = mockQueryRaw.mock.calls[0]
    const joined = (sql as { strings: string[] }).strings.join('')
    expect(joined).toContain('"key"')
    expect(joined).toContain('"count"')
  })
})
