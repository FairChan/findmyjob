import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { LOCK_NS, lockXact } from '../lib/advisory-locks'
import { logger } from '../lib/logger'

const SCOPE = 'resume-watermark'
const DEFAULT_GLOBAL_LIMIT = 4
const MEMBER_LIMIT = 2
const LEASE_TTL_MS = 60_000
const SETTING_KEY = 'resume.watermarkGlobalConcurrency'

export interface WatermarkLease {
  id: string
  scope: string
  ownerKey: string
  expiresAt: Date
}

async function lockedDatabaseTime(tx: Prisma.TransactionClient): Promise<Date> {
  await lockXact(tx, LOCK_NS.WATERMARK_LEASE, SCOPE)
  // now() is the transaction start time and may predate a long lock wait.
  const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  return row.now
}

export async function acquireWatermarkLease(ownerKey: string): Promise<WatermarkLease | null> {
  return db.$transaction(async (tx) => {
    const now = await lockedDatabaseTime(tx)
    await tx.concurrencyLease.deleteMany({ where: { scope: SCOPE, expiresAt: { lte: now } } })

    // Read through this transaction; process-local settings caches cannot coordinate capacity.
    const setting = await tx.systemSetting.findUnique({ where: { key: SETTING_KEY }, select: { value: true } })
    let globalLimit = DEFAULT_GLOBAL_LIMIT
    if (setting) {
      if (typeof setting.value === 'number' && Number.isSafeInteger(setting.value) && setting.value > 0) {
        globalLimit = setting.value
      } else {
        logger.warn({ setting: SETTING_KEY }, 'Invalid watermark concurrency setting; using default')
      }
    }

    const active = { scope: SCOPE, expiresAt: { gt: now } }
    const globalCount = await tx.concurrencyLease.count({ where: active })
    if (globalCount >= globalLimit) return null
    const memberCount = await tx.concurrencyLease.count({ where: { ...active, ownerKey } })
    if (memberCount >= MEMBER_LIMIT) return null

    return tx.concurrencyLease.create({
      data: { scope: SCOPE, ownerKey, expiresAt: new Date(now.getTime() + LEASE_TTL_MS) },
    })
  }, { maxWait: 5000, timeout: 5000 })
}

export async function renewWatermarkLease(lease: WatermarkLease): Promise<boolean> {
  if (lease.scope !== SCOPE) return false
  return db.$transaction(async (tx) => {
    const now = await lockedDatabaseTime(tx)
    const result = await tx.concurrencyLease.updateMany({
      where: { id: lease.id, scope: SCOPE, ownerKey: lease.ownerKey, expiresAt: { gt: now } },
      data: { expiresAt: new Date(now.getTime() + LEASE_TTL_MS) },
    })
    // Expired or removed leases are never recreated or revived.
    return result.count === 1
  }, { maxWait: 5000, timeout: 5000 })
}

export async function releaseWatermarkLease(lease: WatermarkLease): Promise<void> {
  if (lease.scope !== SCOPE) return
  await db.concurrencyLease.deleteMany({
    where: { id: lease.id, scope: SCOPE, ownerKey: lease.ownerKey },
  })
}
