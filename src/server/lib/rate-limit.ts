import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { hitBucket } from './db-rate-limit'

export interface RateLimitOptions {
  windowMs: number
  limit: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  /** Unix ms at which the window resets */
  resetAt: number
  /** Raw bucket count returned by the DB */
  count: number
}

export async function checkRateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  return hitBucket(key, opts)
}

/** Remove all bucket entries for a key (test isolation / sign-out). */
export async function clearRateLimit(key: string): Promise<void> {
  await db.$executeRaw(Prisma.sql`DELETE FROM "RateLimitBucket" WHERE "key" = ${key}`)
}
