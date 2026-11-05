import 'server-only'
import { db } from '../db'
import { getSetting } from './settings'
import { logAudit } from './audit'
import { VersionMismatchError } from '../errors'

export async function needsReconsent(userId: string): Promise<boolean> {
  const currentVersion = await getSetting('legal.currentVersion', '2026-11-draft')

  const [terms, privacy] = await Promise.all([
    db.consent.findFirst({
      where: { userId, type: 'TERMS', version: currentVersion },
      orderBy: { createdAt: 'desc' },
    }),
    db.consent.findFirst({
      where: { userId, type: 'PRIVACY', version: currentVersion },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return terms?.granted !== true || privacy?.granted !== true
}

export async function recordLegalConsent(
  userId: string,
  opts: { submittedVersion: string; ip?: string; userAgent?: string },
): Promise<void> {
  const currentVersion = await getSetting('legal.currentVersion', '2026-11-draft')

  if (opts.submittedVersion !== currentVersion) {
    throw new VersionMismatchError()
  }

  await db.$transaction([
    db.consent.create({
      data: {
        userId,
        type: 'TERMS',
        version: currentVersion,
        granted: true,
        ip: opts.ip,
        userAgent: opts.userAgent,
      },
    }),
    db.consent.create({
      data: {
        userId,
        type: 'PRIVACY',
        version: currentVersion,
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
    metadata: { version: currentVersion },
  })
}
