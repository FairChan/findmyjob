import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import type { RateLimitOptions, RateLimitResult } from './rate-limit'

/**
 * Fixed-window rate limiter backed by PostgreSQL.
 * Survives process restarts; uses INSERT ON CONFLICT to atomically increment the bucket count.
 */
export async function hitBucket(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = Date.now()
  const windowEndMs = Math.ceil(now / opts.windowMs) * opts.windowMs
  const windowEnd = new Date(windowEndMs)

  const rows = await db.$queryRaw<[{ count: bigint }]>(Prisma.sql`
    INSERT INTO "RateLimitBucket" ("key", "windowEnd", "count", "createdAt")
    VALUES (${key}, ${windowEnd}, 1, now())
    ON CONFLICT ("key", "windowEnd")
    DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"
  `)

  const count = Number(rows[0].count)
  const allowed = count <= opts.limit

  return {
    allowed,
    remaining: Math.max(0, opts.limit - count),
    resetAt: windowEndMs,
    count,
  }
}
