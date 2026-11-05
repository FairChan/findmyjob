/**
 * Integration test: RateLimitBucket persistence across PrismaClient instances.
 * Verifies that the DB-backed implementation counts correctly and that state
 * survives process restarts (a new PrismaClient still sees the previous count).
 */
import { describe, it, expect } from 'vitest'
import { PrismaClient, Prisma } from '@prisma/client'
import { setupTestDb } from '../setup/db'

setupTestDb()

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? ''

async function hitBucketWith(
  client: PrismaClient,
  key: string,
  opts: { windowMs: number; limit: number },
): Promise<{ allowed: boolean; count: number }> {
  const now = Date.now()
  const windowEndMs = Math.ceil(now / opts.windowMs) * opts.windowMs
  const windowEnd = new Date(windowEndMs)
  const rows = await client.$queryRaw<[{ count: bigint }]>(Prisma.sql`
    INSERT INTO "RateLimitBucket" ("key", "windowEnd", "count", "createdAt")
    VALUES (${key}, ${windowEnd}, 1, now())
    ON CONFLICT ("key", "windowEnd")
    DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"
  `)
  const count = Number(rows[0].count)
  return { allowed: count <= opts.limit, count }
}

describe('RateLimitBucket persistence', () => {
  it('blocks the 6th hit issued by a fresh PrismaClient', async () => {
    const opts = { windowMs: 60_000, limit: 5 }
    const key = 'test:rl:integration'

    const client1 = new PrismaClient({ datasources: { db: { url: TEST_URL } }, log: [] })
    try {
      for (let i = 1; i <= 5; i++) {
        const r = await hitBucketWith(client1, key, opts)
        expect(r.allowed).toBe(true)
        expect(r.count).toBe(i)
      }
    } finally {
      await client1.$disconnect()
    }

    // A brand-new PrismaClient — no shared in-memory state with client1
    const client2 = new PrismaClient({ datasources: { db: { url: TEST_URL } }, log: [] })
    try {
      const r6 = await hitBucketWith(client2, key, opts)
      expect(r6.allowed).toBe(false)
      expect(r6.count).toBe(6)
    } finally {
      await client2.$disconnect()
    }
  })
})
