import 'server-only'
import type { ConsentType } from '@prisma/client'
import { db } from '../db'
import { ValidationError } from '../errors'
import { getSetting } from './settings'
import { prepareLegalConsentWriteTx } from './legal-consent-write'

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
  if (consents.some(consent => consent.type === 'MARKETING')) throw new ValidationError('Marketing consent requires its controlled service')
  // Reject mixed batches before any settings read or consent insert.
  if (consents.some(consent => ['AI_RESUME_PARSE', 'AI_MATCHING'].includes(consent.type))) {
    throw new ValidationError('AI consent requires its dedicated consent service')
  }
  if (consents.some(consent => consent.type === 'TERMS' || consent.type === 'PRIVACY')) {
    await db.$transaction(async tx => {
      const { version, createdAt } = await prepareLegalConsentWriteTx(tx, userId, '1.0')
      await tx.consent.createMany({ data: consents.map((consent, index) => ({
        userId, type: consent.type, version, granted: consent.granted,
        ip: meta.ip ?? null, userAgent: meta.userAgent ?? null,
        createdAt: new Date(createdAt.getTime() + index),
      })) })
    })
    return
  }
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
