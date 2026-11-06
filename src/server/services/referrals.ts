import 'server-only'
import { randomBytes } from 'node:crypto'
import { db } from '../db'
import { getSetting } from './settings'
import { logAudit } from './audit'

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
  await db.referral.updateMany({
    where: { id: referral.id, status: 'PENDING' },
    data: { status: 'QUALIFIED', qualifiedAt: new Date() },
  })
}

/** Void a referral (admin operation). Writes a referral.void audit entry. */
export async function voidReferral(id: string, reason: string, actorId: string): Promise<void> {
  await db.referral.update({
    where: { id },
    data: { status: 'VOID', voidReason: reason },
  })
  await logAudit({
    actorId,
    action: 'referral.void',
    targetType: 'Referral',
    targetId: id,
    metadata: { reason },
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
    }
  }

  return { qualified }
}
