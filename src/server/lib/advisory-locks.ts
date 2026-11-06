import 'server-only'
import type { Prisma } from '@prisma/client'

export const LOCK_NS = {
  JOB_VIEW_QUOTA: 1001,
  PROFILE_VIEW: 1002,
  CREDIT: 1003,
} as const

/**
 * Acquires a transaction-scoped advisory lock keyed by namespace + id.
 * Must be called inside a db.$transaction; the lock is released automatically on commit/rollback.
 */
export async function lockXact(
  tx: Prisma.TransactionClient,
  ns: number,
  id: string
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ns}::int, hashtext(${id})::int)`
}
