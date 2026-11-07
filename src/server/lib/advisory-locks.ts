import 'server-only'
import type { Prisma } from '@prisma/client'

// 号段约定（2026-11-08，两条开发线已同意）：1001～1004 已用；主线新增用 1005～1049，线 B 新增用 1050～1099。
// 值必须两两不同，tests/unit/advisory-locks.test.ts 会检查。
export const LOCK_NS = {
  JOB_VIEW_QUOTA: 1001,
  PROFILE_VIEW: 1002,
  CREDIT: 1003,
  // 线 B 原来用的是 1003，和 M4 的 CREDIT 撞号；M4 合并时改成 1004
  MANAGED_TRANSFER: 1004,
  APPLICATION: 1005,
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
