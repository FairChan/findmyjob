import 'server-only'
import { db } from '../db'
import { getSetting } from './settings'
import { logAudit } from './audit'

export async function needsReconsent(userId: string): Promise<boolean> {
  const currentVersion = await getSetting('legal.currentVersion', '2026-11-draft')

  const [terms, privacy] = await Promise.all([
    db.consent.findFirst({
      where: { userId, type: 'TERMS', granted: true, version: currentVersion },
      orderBy: { createdAt: 'desc' },
    }),
    db.consent.findFirst({
      where: { userId, type: 'PRIVACY', granted: true, version: currentVersion },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return terms === null || privacy === null
}

export async function recordLegalConsent(
  userId: string,
  opts: { version: string; ip?: string; userAgent?: string },
): Promise<void> {
  await db.$transaction([
    db.consent.create({
      data: {
        userId,
        type: 'TERMS',
        version: opts.version,
        granted: true,
        ip: opts.ip,
        userAgent: opts.userAgent,
      },
    }),
    db.consent.create({
      data: {
        userId,
        type: 'PRIVACY',
        version: opts.version,
        granted: true,
        ip: opts.ip,
        userAgent: opts.userAgent,
      },
    }),
  ])

  await logAudit({
    actorId: userId,
    action: 'user.reconsent',
    targetType: 'User',
    targetId: userId,
    metadata: { version: opts.version },
  })
}
