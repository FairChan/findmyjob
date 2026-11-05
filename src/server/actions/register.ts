'use server'
import { z } from 'zod'
import { headers, cookies } from 'next/headers'
import { action } from '@/server/action'
import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { getClientIp } from '@/server/lib/client-ip'
import { AppError, SignupClosedError, RateLimitedError, ValidationError } from '@/server/errors'
import { logger } from '@/server/lib/logger'
import { env } from '@/env'
import { employerRegistrationContext } from '@/server/lib/employer-registration-context'

const signUpUrl = new URL('/api/auth/sign-up/email', env.APP_URL).toString()

const studentInput = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  agreeTerms: z.literal(true),
  agreePrivacy: z.literal(true),
  joinTalentPool: z.boolean().default(false),
  ref: z.string().max(255).optional(),
  turnstileToken: z.string().min(1).max(2048),
})

const employerInput = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  agreeTerms: z.literal(true),
  agreePrivacy: z.literal(true),
  turnstileToken: z.string().min(1).max(2048),
})

/**
 * Calls auth.handler for /sign-up/email, which runs the full Better Auth
 * middleware stack: Turnstile hook → rate limit → user creation.
 * Returns the parsed response body or throws an AppError.
 */
async function callAuthSignUp(
  body: Record<string, unknown>,
  ip: string | null,
  userAgent: string | null,
): Promise<{ user: { id: string; email: string } }> {
  const request = new Request(signUpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: env.APP_URL,
      ...(ip ? { 'x-real-ip': ip } : {}),
      ...(userAgent ? { 'user-agent': userAgent } : {}),
    },
    body: JSON.stringify(body),
  })

  const response = await auth.handler(request)

  if (!response.ok) {
    const errBody = await response.json().catch(() => null) as Record<string, unknown> | null
    const code = errBody?.code as string | undefined

    if (response.status === 429) throw new RateLimitedError()
    if (code === 'TURNSTILE_FAILED') throw new AppError('Turnstile verification failed', 'TURNSTILE_FAILED')
    if (code === 'SIGNUP_CLOSED') throw new SignupClosedError()
    if (code === 'CONSENT_REQUIRED') throw new ValidationError('Consent required')

    logger.warn({ status: response.status, code }, 'Sign-up failed')
    throw new AppError('Registration failed', 'REGISTER_FAILED')
  }

  const data = await response.json() as { user?: { id?: string; email?: string } }
  const userId = data?.user?.id
  const email = data?.user?.email
  if (!userId || !email) throw new AppError('Registration failed', 'REGISTER_FAILED')
  return { user: { id: userId, email } }
}

export const registerStudent = action(
  { auth: 'public', input: studentInput },
  async ({ input }) => {
    const h = await headers()
    const ip = getClientIp(h)
    const userAgent = h.get('user-agent')

    // Set ref_code cookie for BOTH real and duplicate emails so neither path
    // reveals whether an email is already registered.
    if (input.ref) {
      const jar = await cookies()
      jar.set('ref_code', input.ref, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60,
        path: '/',
      })
    }

    const { user } = await callAuthSignUp(
      {
        name: input.name,
        email: input.email,
        password: input.password,
        turnstileToken: input.turnstileToken,
        agreeTerms: input.agreeTerms,
        agreePrivacy: input.agreePrivacy,
        // Pass joinTalentPool so databaseHooks.user.create.after can read it.
        joinTalentPool: input.joinTalentPool,
      },
      ip,
      userAgent,
    )

    // Anti-enum: Better Auth returns a fake user when requireEmailVerification=true
    // and the email is already registered. The fake user won't be in the DB.
    // Profile and Consent are created in databaseHooks.user.create.after in auth.ts.
    const realUser = await db.user.findUnique({ where: { id: user.id }, select: { id: true } })
    if (!realUser) {
      // Duplicate email — reminder sent by onExistingUserSignUp in auth.ts.
      return { email: input.email }
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

    // Run inside employer context so the before-hook and databaseHook skip the
    // student cap check and set role=EMPLOYER in the INSERT.
    // Consent is created in databaseHooks.user.create.after in auth.ts.
    const { user } = await employerRegistrationContext.run(true, () =>
      callAuthSignUp(
        {
          name: input.name,
          email: input.email,
          password: input.password,
          turnstileToken: input.turnstileToken,
          agreeTerms: input.agreeTerms,
          agreePrivacy: input.agreePrivacy,
        },
        ip,
        userAgent,
      ),
    )

    // Anti-enum: check whether the returned user actually exists.
    const realUser = await db.user.findUnique({ where: { id: user.id }, select: { id: true } })
    if (!realUser) {
      // Duplicate email — reminder sent by onExistingUserSignUp in auth.ts.
      return { email: input.email }
    }

    return { email: input.email }
  },
)
