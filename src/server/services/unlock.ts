import 'server-only'
import { LedgerReason, UnlockSource } from '@prisma/client'
import { db } from '../db'
import { NotFoundError, RateLimitedError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { logger } from '../lib/logger'
import { logAudit } from './audit'
import { applyLedgerEntry } from './credits'
import { isStudentVisibleToCompany } from './talent-visibility'
import { assertUnlockEnabled } from './feature-flags'
import { getSetting } from './settings'
import { createNotification } from './notifications'

export interface UnlockResult {
  unlockId: string
  alreadyUnlocked: boolean
}

function todayUTCStart(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export async function unlockStudent(
  ctx: { userId: string; companyId: string },
  studentId: string,
): Promise<UnlockResult> {
  await assertUnlockEnabled()

  const visible = await isStudentVisibleToCompany(studentId, ctx.companyId)
  if (!visible) throw new NotFoundError('Student profile not found or not visible')

  // Read settings before the transaction to avoid borrowing a second connection while holding one
  const dailyLimit = await getSetting<number>('limits.unlocksPerDay', 50)
  const cost = await getSetting<number>('unlock.costCredits', 1)

  type TxResult =
    | { kind: 'alreadyUnlocked'; unlockId: string }
    | { kind: 'limitHit' }
    | { kind: 'unlocked'; unlockId: string }

  const txResult: TxResult = await db.$transaction(async (tx) => {
    // Serialise all unlocks for this company via advisory lock (same lock used by applyLedgerEntry).
    await lockXact(tx, LOCK_NS.CREDIT, ctx.companyId)

    const existing = await tx.talentUnlock.findUnique({
      where: { companyId_studentId: { companyId: ctx.companyId, studentId } },
      select: { id: true },
    })
    if (existing) {
      return { kind: 'alreadyUnlocked', unlockId: existing.id }
    }

    const startOfToday = todayUTCStart()
    const todayCount = await tx.talentUnlock.count({
      where: { unlockedById: ctx.userId, createdAt: { gte: startOfToday } },
    })
    if (todayCount >= dailyLimit) {
      return { kind: 'limitHit' }
    }

    const unlock = await tx.talentUnlock.create({
      data: {
        companyId: ctx.companyId,
        studentId,
        unlockedById: ctx.userId,
        source: UnlockSource.CREDIT,
        creditsSpent: cost,
      },
    })

    await applyLedgerEntry(tx, {
      companyId: ctx.companyId,
      delta: -cost,
      reason: LedgerReason.UNLOCK,
      refType: 'TalentUnlock',
      refId: unlock.id,
      actorId: ctx.userId,
    })

    // Audit inside the transaction so a write failure rolls back the entire unlock
    await logAudit({
      actorId: ctx.userId,
      action: 'talent.unlock',
      targetType: 'TalentUnlock',
      targetId: unlock.id,
      metadata: { companyId: ctx.companyId, studentId },
    }, tx)

    return { kind: 'unlocked', unlockId: unlock.id }
  })

  if (txResult.kind === 'limitHit') {
    // talent.limit.hit is intentionally outside the transaction
    await logAudit({
      actorId: ctx.userId,
      action: 'talent.limit.hit',
      targetType: 'TalentUnlock',
      metadata: { kind: 'memberDailyUnlocks', companyId: ctx.companyId },
    })
    throw new RateLimitedError('Daily unlock limit reached')
  }

  if (txResult.kind === 'unlocked') {
    // Notify student post-commit; failure must not roll back the already-committed unlock
    const profile = await db.studentProfile.findUnique({
      where: { id: studentId },
      select: { userId: true },
    })
    if (profile) {
      try {
        await createNotification(db, profile.userId, 'talent.unlock', {
          companyId: ctx.companyId,
          unlockId: txResult.unlockId,
        })
      } catch {
        logger.error({ unlockId: txResult.unlockId }, 'Failed to send unlock notification')
      }
    }
  }

  return {
    unlockId: txResult.unlockId,
    alreadyUnlocked: txResult.kind === 'alreadyUnlocked',
  }
}
