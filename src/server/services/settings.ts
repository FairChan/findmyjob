import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { logAudit } from './audit'

const TTL_MS = 60_000

interface CacheEntry {
  value: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T
  }

  const row = await db.systemSetting.findUnique({ where: { key } })
  const value: T = row !== null ? (row.value as T) : defaultValue
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS })
  return value
}

export async function setSetting(
  key: string,
  value: unknown,
  actorId?: string,
): Promise<void> {
  const jsonValue = value as Prisma.InputJsonValue
  await db.systemSetting.upsert({
    where: { key },
    create: { key, value: jsonValue, updatedById: actorId },
    update: { value: jsonValue, updatedById: actorId },
  })
  cache.delete(key)
  await logAudit({
    actorId,
    action: 'setting.update',
    targetType: 'SystemSetting',
    targetId: key,
  })
}
