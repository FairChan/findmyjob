import 'server-only'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { Prisma, ReferralStatus } from '@prisma/client'
import type { UserCtx } from '../authz'
import { db } from '../db'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { getSetting } from './settings'
import { logAudit } from './audit'
import { createNotification } from './notifications'
import { logger } from '../lib/logger'

const referralIdSchema = z.string().trim().min(1).max(128)
const referralCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: referralIdSchema,
}).strict()

function decodeReferralCursor(raw: string): z.infer<typeof referralCursorSchema> | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const parsed = referralCursorSchema.safeParse(JSON.parse(json) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const voidReferralSchema = z.object({
  referralId: referralIdSchema,
  reason: z.string().trim().min(1).max(500),
})

export const listReferralsSchema = z.object({
  cursor: z.string().trim().min(1).max(1024)
    .refine((value) => decodeReferralCursor(value) !== null, 'Invalid cursor').optional(),
  limit: z.number().int().min(1).max(50).default(25),
  status: z.enum(['PENDING', 'QUALIFIED', 'VOID']).optional(),
  referrerId: referralIdSchema.optional(),
})

export type ListReferralsInput = z.input<typeof listReferralsSchema>

function parseAdminInput<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input')
  }
  return parsed.data
}

async function assertAdmin(client: Prisma.TransactionClient, userId: string): Promise<void> {
  const actor = await client.user.findUnique({
    where: { id: userId }, select: { role: true, status: true },
  })
  if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
    throw new ForbiddenError()
  }
}

/** Normalize email for self-referral detection: lowercase; for Gmail, remove dots and +tag from local part */
export function normalizeEmail(email: string): string {
  const lower = email.toLowerCase()
  const atIndex = lower.lastIndexOf('@')
  if (atIndex < 0) return lower
  const local = lower.slice(0, atIndex)
  const domain = lower.slice(atIndex + 1)
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const withoutTag = local.replace(/\+.*$/, '')
    const withoutDots = withoutTag.replace(/\./g, '')
    return `${withoutDots}@gmail.com`
  }
  return lower
}

/** Returns the UTC Date corresponding to 00:00 Asia/Kuala_Lumpur on the current calendar day */
function getKLDayStartUTC(): Date {
  const klDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })
  return new Date(`${klDateStr}T00:00:00+08:00`)
}

export async function getOrCreateReferralCode(studentId: string): Promise<string> {
  const existing = await db.studentProfile.findUnique({
    where: { id: studentId },
    select: { referralCode: true },
  })
  if (!existing) throw new Error('StudentProfile not found')
  if (existing.referralCode) return existing.referralCode

  const code = randomBytes(6).toString('base64url').slice(0, 8)
  await db.studentProfile.update({
    where: { id: studentId },
    data: { referralCode: code },
  })
  return code
}

/** Attach a referral record when an invitee registers via invitation link. Idempotent — second call for same invitee is ignored. */
export async function attachReferral(inviteeStudentId: string, code: string): Promise<void> {
  const referrer = await db.studentProfile.findUnique({
    where: { referralCode: code },
    select: { id: true, userId: true },
  })
  if (!referrer) return

  if (referrer.id === inviteeStudentId) return

  const [referrerUser, inviteeProfile] = await Promise.all([
    db.user.findUnique({ where: { id: referrer.userId }, select: { email: true } }),
    db.studentProfile.findUnique({ where: { id: inviteeStudentId }, select: { userId: true } }),
  ])
  if (!inviteeProfile) return

  if (referrerUser) {
    const inviteeUser = await db.user.findUnique({
      where: { id: inviteeProfile.userId },
      select: { email: true },
    })
    if (inviteeUser && normalizeEmail(referrerUser.email) === normalizeEmail(inviteeUser.email)) return
  }

  // Upsert: if invitee already has a referral record, leave it unchanged
  await db.referral.upsert({
    where: { inviteeId: inviteeStudentId },
    update: {},
    create: {
      referrerId: referrer.id,
      inviteeId: inviteeStudentId,
      status: 'PENDING',
    },
  })
}

/** Check whether a pending referral for the given invitee now qualifies; call after every profile save. */
export async function qualifyReferral(inviteeStudentId: string): Promise<void> {
  const referral = await db.referral.findFirst({
    where: { inviteeId: inviteeStudentId, status: 'PENDING' },
  })
  if (!referral) return

  const inviteeProfile = await db.studentProfile.findUnique({
    where: { id: inviteeStudentId },
    select: { userId: true, completeness: true, schoolVerifiedAt: true },
  })
  if (!inviteeProfile) return

  const inviteeUser = await db.user.findUnique({
    where: { id: inviteeProfile.userId },
    select: { emailVerified: true },
  })
  if (!inviteeUser?.emailVerified) return

  const [minCompleteness, requireSchoolVerified, maxQualifiedPerDay] = await Promise.all([
    getSetting<number>('referral.minCompleteness', 90),
    getSetting<boolean>('referral.requireSchoolVerified', false),
    getSetting<number>('referral.maxQualifiedPerDay', 3),
  ])

  if (inviteeProfile.completeness < minCompleteness) return
  if (requireSchoolVerified && !inviteeProfile.schoolVerifiedAt) return

  const dayStart = getKLDayStartUTC()
  const qualifiedTodayCount = await db.referral.count({
    where: {
      referrerId: referral.referrerId,
      status: 'QUALIFIED',
      qualifiedAt: { gte: dayStart },
    },
  })
  if (qualifiedTodayCount >= maxQualifiedPerDay) return

  // Conditional update: only succeeds if still PENDING (idempotent under concurrent saves)
  const updated = await db.referral.updateMany({
    where: { id: referral.id, status: 'PENDING' },
    data: { status: 'QUALIFIED', qualifiedAt: new Date() },
  })

  if (updated.count > 0) {
    const referrerProfile = await db.studentProfile.findUnique({
      where: { id: referral.referrerId },
      select: { userId: true },
    })
    if (referrerProfile) {
      await createNotification(db, referrerProfile.userId, 'referral.qualified', {
        referralId: referral.id,
        inviteeId: inviteeStudentId,
      }).catch((err) => {
        logger.error({ err, referralId: referral.id }, 'Failed to send referral.qualified notification')
      })
    }
  }
}

/** Void a referral (admin operation). Writes a referral.void audit entry. */
export async function voidReferral(id: string, reason: string, actorId: string): Promise<void> {
  const input = parseAdminInput(voidReferralSchema, { referralId: id, reason })
  await db.$transaction(async (tx) => {
    await assertAdmin(tx, actorId)
    const existing = await tx.referral.findUnique({
      where: { id: input.referralId }, select: { referrerId: true },
    })
    if (!existing) throw new NotFoundError()
    await lockXact(tx, LOCK_NS.JOB_VIEW_QUOTA, existing.referrerId)

    // Qualification can race the initial read. Compare the precise status so the
    // audit describes the transition actually made, and never resurrect VOID.
    for (;;) {
      const referral = await tx.referral.findUnique({
        where: { id: input.referralId }, select: { status: true },
      })
      if (!referral) throw new NotFoundError()
      if (referral.status === 'VOID') return
      const updated = await tx.referral.updateMany({
        where: { id: input.referralId, status: referral.status },
        data: { status: 'VOID', voidReason: input.reason },
      })
      if (updated.count === 0) continue
      await logAudit({
        actorId,
        action: 'referral.void',
        targetType: 'Referral',
        targetId: input.referralId,
        metadata: { fromStatus: referral.status, toStatus: 'VOID', reasonLength: input.reason.length },
      }, tx)
      return
    }
  })
}

/** Re-evaluate all PENDING referrals that now meet qualification criteria. Run daily at 00:15 KL time. */
export async function requalifyReferrals(): Promise<{ qualified: number }> {
  const [minCompleteness, requireSchoolVerified, maxQualifiedPerDay] = await Promise.all([
    getSetting<number>('referral.minCompleteness', 90),
    getSetting<boolean>('referral.requireSchoolVerified', false),
    getSetting<number>('referral.maxQualifiedPerDay', 3),
  ])

  const dayStart = getKLDayStartUTC()

  const pendingReferrals = await db.referral.findMany({
    where: { status: 'PENDING' },
    include: {
      invitee: {
        select: { userId: true, completeness: true, schoolVerifiedAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Track how many were qualified today per referrer (seed from DB then increment locally)
  const qualifiedTodayByReferrer = new Map<string, number>()

  let qualified = 0

  for (const ref of pendingReferrals) {
    const inviteeProfile = ref.invitee
    if (!inviteeProfile) continue

    const inviteeUser = await db.user.findUnique({
      where: { id: inviteeProfile.userId },
      select: { emailVerified: true },
    })
    if (!inviteeUser?.emailVerified) continue
    if (inviteeProfile.completeness < minCompleteness) continue
    if (requireSchoolVerified && !inviteeProfile.schoolVerifiedAt) continue

    if (!qualifiedTodayByReferrer.has(ref.referrerId)) {
      const count = await db.referral.count({
        where: { referrerId: ref.referrerId, status: 'QUALIFIED', qualifiedAt: { gte: dayStart } },
      })
      qualifiedTodayByReferrer.set(ref.referrerId, count)
    }

    const todayCount = qualifiedTodayByReferrer.get(ref.referrerId) ?? 0
    if (todayCount >= maxQualifiedPerDay) continue

    const result = await db.referral.updateMany({
      where: { id: ref.id, status: 'PENDING' },
      data: { status: 'QUALIFIED', qualifiedAt: new Date() },
    })

    if (result.count > 0) {
      qualifiedTodayByReferrer.set(ref.referrerId, todayCount + 1)
      qualified++

      const referrerProfile = await db.studentProfile.findUnique({
        where: { id: ref.referrerId },
        select: { userId: true },
      })
      if (referrerProfile) {
        await createNotification(db, referrerProfile.userId, 'referral.qualified', {
          referralId: ref.id,
          inviteeId: ref.inviteeId,
        }).catch((err) => {
          logger.error({ err, referralId: ref.id }, 'Failed to send referral.qualified notification in requalify')
        })
      }
    }
  }

  return { qualified }
}

export type AdminReferralRow = {
  id: string
  referrerId: string
  inviteeId: string
  referrerName: string
  inviteeName: string
  status: ReferralStatus
  qualifiedAt: Date | null
  voidReason: string | null
  createdAt: Date
}

export async function listReferrals(
  ctx: UserCtx,
  rawInput: ListReferralsInput = {},
): Promise<{ items: AdminReferralRow[]; nextCursor: string | null }> {
  await assertAdmin(db, ctx.userId)
  const input = parseAdminInput(listReferralsSchema, rawInput)
  const cursor = input.cursor ? decodeReferralCursor(input.cursor) : null
  const rows = await db.referral.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.referrerId ? { referrerId: input.referrerId } : {}),
      ...(cursor ? {
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    select: {
      id: true, referrerId: true, inviteeId: true, status: true,
      qualifiedAt: true, voidReason: true, createdAt: true,
      referrer: { select: { fullName: true } },
      invitee: { select: { fullName: true } },
    },
  })
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  const nextCursor = rows.length > input.limit && last
    ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url')
    : null
  return {
    items: page.map(({ referrer, invitee, ...row }) => ({
      ...row, referrerName: referrer.fullName, inviteeName: invitee.fullName,
    })),
    nextCursor,
  }
}
