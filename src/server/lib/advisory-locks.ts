import 'server-only'
import type { Prisma } from '@prisma/client'

export const LOCK_NS = {
  JOB_VIEW_QUOTA: 1001,
  PROFILE_VIEW: 1002,
  CREDIT: 1003,
  // 线 B 原来用的是 1003，和 M4 的 CREDIT 撞号；M4 合并时改成 1004（2026-11-08，两条线已约定）。新增命名空间从 1005 开始，唯一性由 tests/unit/advisory-locks.test.ts 保证
  MANAGED_TRANSFER: 1004,
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
