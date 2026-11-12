import 'server-only'
import { db } from '../db'
import { getSetting } from './settings'
import { logAudit } from './audit'
import { VersionMismatchError } from '../errors'
import { prepareLegalConsentWriteTx } from './legal-consent-write'

export async function needsReconsent(userId: string): Promise<boolean> {
  const currentVersion = await getSetting('legal.currentVersion', '2026-11-draft')

  // Query the LATEST record for each consent type regardless of version.
  // A revocation (granted=false) recorded under any version must be honoured;
  // granting under an old version also requires reconsent for the new version.
  const [terms, privacy] = await Promise.all([
    db.consent.findFirst({
      where: { userId, type: 'TERMS' },
      orderBy: { createdAt: 'desc' },
    }),
    db.consent.findFirst({
      where: { userId, type: 'PRIVACY' },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return (
    terms?.granted !== true || terms.version !== currentVersion ||
    privacy?.granted !== true || privacy.version !== currentVersion
  )
}

export async function recordLegalConsent(
  userId: string,
  opts: { submittedVersion: string; ip?: string; userAgent?: string },
): Promise<void> {
  await db.$transaction(async tx => {
    const { version: currentVersion, createdAt } = await prepareLegalConsentWriteTx(tx, userId)
    if (opts.submittedVersion !== currentVersion) throw new VersionMismatchError()
    await tx.consent.create({
      data: {
        userId,
        type: 'TERMS',
        version: currentVersion,
        granted: true,
        createdAt,
        ip: opts.ip,
        userAgent: opts.userAgent,
      },
    })
    await tx.consent.create({
      data: {
        userId,
        type: 'PRIVACY',
        version: currentVersion,
        granted: true,
        createdAt,
        ip: opts.ip,
        userAgent: opts.userAgent,
      },
    })
    await logAudit({
      actorId: userId,
      action: 'user.reconsent',
      targetType: 'User',
      targetId: userId,
      metadata: { version: currentVersion },
    }, tx)
  })
}
