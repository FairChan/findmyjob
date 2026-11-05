import 'server-only'
import type { ConsentType } from '@prisma/client'
import { db } from '../db'
import { getSetting } from './settings'

export interface ConsentEntry {
  type: ConsentType
  granted: boolean
}

export interface ConsentMeta {
  ip?: string | null
  userAgent?: string | null
}

export async function recordConsents(
  userId: string,
  consents: ConsentEntry[],
  meta: ConsentMeta,
): Promise<void> {
  const version = await getSetting<string>('legal.currentVersion', '1.0')
  await db.consent.createMany({
    data: consents.map((c) => ({
      userId,
      type: c.type,
      version,
      granted: c.granted,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })),
  })
}
