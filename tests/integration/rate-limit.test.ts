/**
 * Integration test: rate-limit persistence via actual hitBucket/checkRateLimit.
 * The @/server/db module is redirected to the test database so the functions
 * under test run against real PostgreSQL without touching the main DB.
 */
import { vi, describe, it, expect, afterAll } from 'vitest'
import { PrismaClient, Prisma } from '@prisma/client'
import { setupTestDb } from '../setup/db'

// Redirect the app-level db singleton to the test database.
vi.mock('@/server/db', async () => {
  const { PrismaClient: PC } = await import('@prisma/client')
  return {
    db: new PC({
      datasources: { db: { url: process.env.TEST_DATABASE_URL } },
      log: [],
    }),
  }
})

// Import real implementations AFTER the mock is registered.
const { hitBucket } = await import('@/server/lib/db-rate-limit')
const { checkRateLimit, clearRateLimit } = await import('@/server/lib/rate-limit')

setupTestDb()

// 1-hour window avoids cross-boundary flakiness without changing hitBucket's interface.
const WINDOW_MS = 3_600_000
const OPTS = { windowMs: WINDOW_MS, limit: 5 }

describe('hitBucket — real counting', () => {
  it('increments count and returns correct allowed/remaining on each hit', async () => {
    const key = 'rl:int:counting'
    for (let i = 1; i <= 5; i++) {
      const r = await hitBucket(key, OPTS)
      expect(r.count).toBe(i)
      expect(r.allowed).toBe(true)
      expect(r.remaining).toBe(OPTS.limit - i)
    }
  })

  it('blocks (allowed=false) on the 6th hit', async () => {
    const key = 'rl:int:block'
    for (let i = 1; i <= 5; i++) await hitBucket(key, OPTS)
    const r6 = await hitBucket(key, OPTS)
    expect(r6.allowed).toBe(false)
    expect(r6.count).toBe(6)
    expect(r6.remaining).toBe(0)
  })
})

describe('checkRateLimit — delegates to hitBucket', () => {
  it('returns allowed=true for first hit', async () => {
    const key = 'rl:int:check:first'
    const r = await checkRateLimit(key, OPTS)
    expect(r.allowed).toBe(true)
    expect(r.count).toBe(1)
  })
})

describe('DB persistence — new PrismaClient sees accumulated count', () => {
  it('6th hit via a fresh PrismaClient connected to the same DB is still blocked', async () => {
    const key = 'rl:int:persist'
    // 5 hits via the real hitBucket (uses the mocked db singleton)
    for (let i = 1; i <= 5; i++) await hitBucket(key, OPTS)

    // Fresh client — no shared in-memory state with the mocked singleton
    const fresh = new PrismaClient({
      datasources: { db: { url: process.env.TEST_DATABASE_URL } },
      log: [],
    })
    const now = Date.now()
    const windowEnd = new Date(Math.ceil(now / WINDOW_MS) * WINDOW_MS)
    const rows = await fresh.$queryRaw<[{ count: bigint }]>(Prisma.sql`
      INSERT INTO "RateLimitBucket" ("key", "windowEnd", "count", "createdAt")
      VALUES (${key}, ${windowEnd}, 1, now())
      ON CONFLICT ("key", "windowEnd")
      DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
      RETURNING "count"
    `)
    await fresh.$disconnect()

    const count = Number(rows[0].count)
    expect(count).toBe(6)
    expect(count > OPTS.limit).toBe(true)
  })
})

describe('key isolation', () => {
  it('different keys do not share counts', async () => {
    const keyA = 'rl:int:iso:a'
    const keyB = 'rl:int:iso:b'
    for (let i = 1; i <= 5; i++) await hitBucket(keyA, OPTS)
    // keyB is untouched — first hit should still be allowed
    const rB = await hitBucket(keyB, OPTS)
    expect(rB.allowed).toBe(true)
    expect(rB.count).toBe(1)
    // keyA should be blocked on the 6th hit
    const rA6 = await hitBucket(keyA, OPTS)
    expect(rA6.allowed).toBe(false)
  })
})

describe('resetAt', () => {
  it('is in the future aligned to the window boundary', async () => {
    const key = 'rl:int:reset'
    const before = Date.now()
    const r = await hitBucket(key, OPTS)
    expect(r.resetAt).toBeGreaterThan(before)
    expect(r.resetAt % WINDOW_MS).toBe(0)
  })
})

describe('clearRateLimit', () => {
  it('removes all bucket rows for the key', async () => {
    const key = 'rl:int:clear'
    for (let i = 1; i <= 3; i++) await hitBucket(key, OPTS)
    await clearRateLimit(key)
    // After clearing, the first hit should start count at 1 again
    const r = await hitBucket(key, OPTS)
    expect(r.count).toBe(1)
    expect(r.allowed).toBe(true)
  })
})

afterAll(async () => {
  // Disconnect the client created inside the vi.mock factory
  const { db } = await import('@/server/db')
  await (db as PrismaClient).$disconnect()
})
