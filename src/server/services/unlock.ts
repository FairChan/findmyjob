import 'server-only'
import { LedgerReason, Prisma, UnlockSource } from '@prisma/client'
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
import { sendNotificationEmail } from './notify'
import { hitBucket } from '../lib/db-rate-limit'

export interface UnlockResult {
  unlockId: string
  alreadyUnlocked: boolean
}

async function readUnlockSetting(key: string, defaultValue: number): Promise<number> {
  const value = await getSetting<unknown>(key, defaultValue)
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  logger.warn({ key, defaultValue }, 'Invalid unlock setting; using default')
  return defaultValue
}

/** Shared by unlock execution and the server-rendered talent detail page. */
export async function getValidatedUnlockSettings(): Promise<{ costCredits: number; dailyLimit: number }> {
  const [costCredits, dailyLimit] = await Promise.all([
    readUnlockSetting('unlock.costCredits', 1),
    readUnlockSetting('limits.unlocksPerDay', 50),
  ])
  return { costCredits, dailyLimit }
}

function isUnlockPairConflict(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  if (error.meta?.modelName !== undefined && error.meta.modelName !== 'TalentUnlock') return false
  const target = error.meta?.target
  return target === 'TalentUnlock_companyId_studentId_key' ||
    (Array.isArray(target) && target.length === 2 && target.includes('companyId') && target.includes('studentId'))
}

// Only a conflict from TalentUnlock.create can reach the recovery path. Other
// unique violations (including ledger or audit failures) must still roll back.
class ConcurrentUnlockError extends Error {
  constructor(readonly original: Prisma.PrismaClientKnownRequestError) {
    super('Concurrent talent unlock')
  }
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
  const { dailyLimit, costCredits: cost } = await getValidatedUnlockSettings()

  type TxResult =
    | { kind: 'alreadyUnlocked'; unlockId: string }
    | { kind: 'limitHit' }
    | { kind: 'unlocked'; unlockId: string; balanceAfter: number }

  let txResult: TxResult
  try {
    txResult = await db.$transaction<TxResult>(async (tx) => {
      // Serialise all unlocks for this company via the same lock as applyLedgerEntry.
      await lockXact(tx, LOCK_NS.CREDIT, ctx.companyId)
      if (!await isStudentVisibleToCompany(studentId, ctx.companyId, tx)) {
        throw new NotFoundError('Student profile not found or not visible')
      }

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
      }).catch((error: unknown) => {
        if (isUnlockPairConflict(error)) throw new ConcurrentUnlockError(error)
        throw error
      })

      const { balanceAfter } = await applyLedgerEntry(tx, {
        companyId: ctx.companyId,
        delta: -cost,
        reason: LedgerReason.UNLOCK,
        refType: 'TalentUnlock',
        refId: unlock.id,
        actorId: ctx.userId,
      })

      // Audit failure rolls back the unlock, wallet change and ledger together.
      await logAudit({
        actorId: ctx.userId,
        action: 'talent.unlock',
        targetType: 'TalentUnlock',
        targetId: unlock.id,
        metadata: { companyId: ctx.companyId, studentId },
      }, tx)

      return { kind: 'unlocked', unlockId: unlock.id, balanceAfter }
    })
  } catch (error) {
    if (!(error instanceof ConcurrentUnlockError)) throw error
    // PostgreSQL aborts a transaction after a unique violation. Recover only
    // after rollback, using a new statement that can see the application commit.
    const existing = await db.talentUnlock.findUnique({
      where: { companyId_studentId: { companyId: ctx.companyId, studentId } },
      select: { id: true },
    })
    if (!existing) throw error.original
    txResult = { kind: 'alreadyUnlocked', unlockId: existing.id }
  }

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
    try {
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
        await sendNotificationEmail(profile.userId, { template: 'talent-unlocked' }).catch(() => {})
      }
    } catch {
      logger.error({ unlockId: txResult.unlockId }, 'Failed to look up unlock notification recipient')
    }

    // Credits-low warning: notify OWNER if balance drops to or below threshold
    const balanceAfter = txResult.balanceAfter
    try {
      const threshold = await getSetting<number>('credits.lowThreshold', 5)
      if (balanceAfter <= threshold) {
        const ONE_DAY_MS = 24 * 60 * 60 * 1000
        const capResult = await hitBucket(`credits.low:${ctx.companyId}`, { windowMs: ONE_DAY_MS, limit: 1 })
        if (capResult.allowed) {
          const owner = await db.companyMember.findFirst({
            where: { companyId: ctx.companyId, role: 'OWNER' },
            select: { userId: true },
          })
          if (owner) {
            try {
              await createNotification(db, owner.userId, 'credits.low', {
                companyId: ctx.companyId,
                balance: balanceAfter,
                threshold,
              })
            } catch {}
            await sendNotificationEmail(owner.userId, {
              template: 'credits-low',
              balance: balanceAfter,
              threshold,
            }).catch(() => {})
          }
        }
      }
    } catch {
      logger.error({ companyId: ctx.companyId }, 'Failed to send low credit warning')
    }
  }

  return {
    unlockId: txResult.unlockId,
    alreadyUnlocked: txResult.kind === 'alreadyUnlocked',
  }
}
