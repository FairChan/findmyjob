import 'server-only'
import crypto from 'crypto'
import { z } from 'zod'
import { db } from '../db'
import { NotFoundError, ValidationError, RateLimitedError } from '../errors'
import { getSetting } from './settings'
import { checkRateLimit } from '../lib/rate-limit'
import { createEmailProvider } from '../../lib/email'
import type { UserCtx } from '../authz'

const OTP_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes
const LOCK_EXPIRY_MS = 30 * 60 * 1000 // 30 minutes
const MAX_ATTEMPTS = 5

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex')
}

function otpIdentifier(userId: string): string {
  return `school-otp:${userId}`
}

function lockIdentifier(userId: string): string {
  return `school-otp-lock:${userId}`
}

interface StoredOtp {
  hash: string
  attempts: number
  schoolId: string
  schoolEmail: string
}

export const requestOtpSchema = z.object({
  schoolId: z.string().cuid(),
  schoolEmail: z.string().email().max(200),
})

export const verifyOtpSchema = z.object({
  otp: z.string().min(1).max(10),
})

export type RequestOtpInput = z.infer<typeof requestOtpSchema>
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>

/** Checks whether the user is locked out from verifying OTPs */
async function assertNotLocked(userId: string): Promise<void> {
  const lockRow = await db.verification.findFirst({
    where: { identifier: lockIdentifier(userId), expiresAt: { gt: new Date() } },
  })
  if (lockRow) throw new RateLimitedError('Too many failed attempts; try again later')
}

/** Request a school email OTP: validates domain, applies rate limits, sends OTP. */
export async function requestSchoolOtp(ctx: UserCtx, input: RequestOtpInput): Promise<void> {
  const { schoolId, schoolEmail } = requestOtpSchema.parse(input)
  const normalizedEmail = schoolEmail.toLowerCase()

  const atIndex = normalizedEmail.indexOf('@')
  if (atIndex < 0) throw new ValidationError('invalid_email')
  const domain = normalizedEmail.slice(atIndex + 1)

  // Check if already locked from too many failed attempts
  await assertNotLocked(ctx.userId)

  // Load school and validate domain — domain must exactly equal one of School.emailDomains
  const school = await db.school.findUnique({
    where: { id: schoolId, active: true },
    select: { id: true, emailDomains: true },
  })
  if (!school) throw new NotFoundError('School not found')

  if (!school.emailDomains.includes(domain)) {
    throw new ValidationError('email_domain_mismatch')
  }

  // Reject if the email is already verified by a *different* account
  const existing = await db.studentProfile.findFirst({
    where: {
      schoolEmail: normalizedEmail,
      userId: { not: ctx.userId },
      schoolVerifiedAt: { not: null },
    },
    select: { id: true },
  })
  if (existing) throw new ValidationError('email_already_verified')

  // Rate limit: per user per hour
  const perHourLimit = await getSetting<number>('limits.otpSendsPerHour', 5)
  const userResult = await checkRateLimit(`school-otp-send:user:${ctx.userId}`, {
    windowMs: 60 * 60 * 1000,
    limit: perHourLimit,
  })
  if (!userResult.allowed) throw new RateLimitedError('OTP send limit exceeded')

  // Rate limit: per target email per day
  const perDayLimit = await getSetting<number>('limits.otpSendsPerEmailPerDay', 5)
  const emailResult = await checkRateLimit(`school-otp-send:email:${normalizedEmail}`, {
    windowMs: 24 * 60 * 60 * 1000,
    limit: perDayLimit,
  })
  if (!emailResult.allowed) throw new RateLimitedError('OTP send limit exceeded for this email')

  // Generate a 6-digit OTP
  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const hash = hashOtp(otp)
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS)
  const stored: StoredOtp = { hash, attempts: 0, schoolId, schoolEmail: normalizedEmail }

  // Replace any existing pending OTP
  const identifier = otpIdentifier(ctx.userId)
  await db.verification.deleteMany({ where: { identifier } })
  await db.verification.create({
    data: { identifier, value: JSON.stringify(stored), expiresAt },
  })

  // Send OTP email (synchronous — user needs it immediately)
  const provider = createEmailProvider()
  await provider.sendEmail({
    to: normalizedEmail,
    subject: 'FindMYJob — School Email Verification Code',
    html: `<p>Your verification code is: <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
    text: `Your verification code is: ${otp}. It expires in 10 minutes.`,
  })
}

/** Verify the OTP and write schoolVerifiedAt to the student profile. */
export async function verifySchoolOtp(ctx: UserCtx, input: VerifyOtpInput): Promise<void> {
  const { otp } = verifyOtpSchema.parse(input)

  // Check lockout first
  await assertNotLocked(ctx.userId)

  const identifier = otpIdentifier(ctx.userId)
  const row = await db.verification.findFirst({
    where: { identifier, expiresAt: { gt: new Date() } },
  })
  if (!row) throw new ValidationError('otp_expired_or_not_found')

  const stored = JSON.parse(row.value) as StoredOtp
  const inputHash = hashOtp(otp)

  // Constant-time comparison to prevent timing attacks
  const storedBuf = Buffer.from(stored.hash, 'hex')
  const inputBuf = Buffer.from(inputHash, 'hex')
  const match =
    storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf)

  if (!match) {
    const newAttempts = stored.attempts + 1
    if (newAttempts >= MAX_ATTEMPTS) {
      // Lock the user for 30 minutes and clear the OTP record
      await db.verification.deleteMany({ where: { identifier } })
      await db.verification.create({
        data: {
          identifier: lockIdentifier(ctx.userId),
          value: 'locked',
          expiresAt: new Date(Date.now() + LOCK_EXPIRY_MS),
        },
      })
    } else {
      // Increment attempt counter
      await db.verification.update({
        where: { id: row.id },
        data: { value: JSON.stringify({ ...stored, attempts: newAttempts }) },
      })
    }
    throw new ValidationError('otp_invalid')
  }

  // OTP correct — clear verification records
  await db.verification.deleteMany({
    where: { identifier: { in: [identifier, lockIdentifier(ctx.userId)] } },
  })

  // Write schoolEmail and schoolVerifiedAt; unique constraint prevents two accounts from sharing the same email
  try {
    await db.studentProfile.update({
      where: { userId: ctx.userId },
      data: {
        schoolEmail: stored.schoolEmail,
        schoolId: stored.schoolId,
        schoolVerifiedAt: new Date(),
      },
    })
  } catch (err: unknown) {
    // P2002 = unique constraint violation: another account already verified this email
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') {
      throw new ValidationError('email_already_verified_by_another')
    }
    throw err
  }
}

/** Returns the list of active schools for the selector. */
export async function listActiveSchools(): Promise<
  { id: string; nameZh: string; nameEn: string; emailDomains: string[] }[]
> {
  return db.school.findMany({
    where: { active: true },
    select: { id: true, nameZh: true, nameEn: true, emailDomains: true },
    orderBy: { nameEn: 'asc' },
  })
}
