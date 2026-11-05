'use server'
import { z } from 'zod'
import { headers, cookies } from 'next/headers'
import { action } from '@/server/action'
import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { recordConsents } from '@/server/services/consent'
import { getClientIp } from '@/server/lib/client-ip'
import { AppError } from '@/server/errors'
import { logger } from '@/server/lib/logger'

const studentInput = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  agreeTerms: z.literal(true),
  agreePrivacy: z.literal(true),
  joinTalentPool: z.boolean().default(false),
  ref: z.string().max(255).optional(),
})

const employerInput = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  agreeTerms: z.literal(true),
  agreePrivacy: z.literal(true),
})

export const registerStudent = action(
  { auth: 'public', input: studentInput },
  async ({ input }) => {
    const h = await headers()
    const ip = getClientIp(h)
    const userAgent = h.get('user-agent')

    let userId: string
    try {
      const result = await auth.api.signUpEmail({
        body: { name: input.name, email: input.email, password: input.password },
        headers: h,
      })
      const user = (result as unknown as { user: { id: string } } | null)?.user
      if (!user?.id) {
        throw new AppError('Sign-up returned no user', 'REGISTER_FAILED')
      }
      userId = user.id
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Student signup failed')
      throw new AppError('Registration failed', 'REGISTER_FAILED')
    }

    // Create minimal StudentProfile with visibility based on TALENT_POOL consent.
    // M2-T01 onboarding wizard will fill remaining fields (upsert-safe: userId is unique).
    await db.studentProfile.create({
      data: {
        userId,
        fullName: input.name,
        visibility: input.joinTalentPool ? 'PUBLIC' : 'HIDDEN',
      },
    })

    await recordConsents(
      userId,
      [
        { type: 'TERMS', granted: true },
        { type: 'PRIVACY', granted: true },
        { type: 'TALENT_POOL', granted: input.joinTalentPool },
      ],
      { ip, userAgent },
    )

    // Persist referral code in a cookie so M2-T09 can call attachReferral
    // once the student's profile completeness is calculated.
    if (input.ref) {
      const jar = await cookies()
      jar.set('ref_code', input.ref, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60,
        path: '/',
      })
    }

    return { email: input.email }
  },
)

export const registerEmployer = action(
  { auth: 'public', input: employerInput },
  async ({ input }) => {
    const h = await headers()
    const ip = getClientIp(h)
    const userAgent = h.get('user-agent')

    let userId: string
    try {
      const result = await auth.api.signUpEmail({
        body: { name: input.name, email: input.email, password: input.password },
        headers: h,
      })
      const user = (result as unknown as { user: { id: string } } | null)?.user
      if (!user?.id) {
        throw new AppError('Sign-up returned no user', 'REGISTER_FAILED')
      }
      userId = user.id
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Employer signup failed')
      throw new AppError('Registration failed', 'REGISTER_FAILED')
    }

    await db.user.update({
      where: { id: userId },
      data: { role: 'EMPLOYER' },
    })

    await recordConsents(
      userId,
      [
        { type: 'TERMS', granted: true },
        { type: 'PRIVACY', granted: true },
      ],
      { ip, userAgent },
    )

    return { email: input.email }
  },
)
