import 'server-only'
import { after } from 'next/server'
import { betterAuth } from 'better-auth'
import { createAuthMiddleware, APIError } from 'better-auth/api'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { db } from './db'
import { env } from '@/env'
import { createEmailProvider } from '@/lib/email'
import { verifyTurnstile, TurnstileError } from './lib/turnstile'
import { logAudit } from './services/audit'
import { getClientIp } from './lib/client-ip'
import { assertStudentSignupOpen, maybeWarnCap } from './services/signup-cap'
import { isEmployerRegistration } from './lib/employer-registration-context'
import { recordConsents } from './services/consent'
import { getSetting } from './services/settings'
import { SignupClosedError } from './errors'
import { logger } from './lib/logger'

const emailProvider = createEmailProvider()

const TURNSTILE_PATHS: Record<string, string> = {
  '/sign-in/email': 'login',
  '/sign-up/email': 'register',
  '/email-otp/send-verification-otp': 'send-otp',
  '/request-password-reset': 'forgot-password',
  '/send-verification-email': 'send-verification',
}

// Combined before-hook: Turnstile verification, consent validation, and signup cap check.
const beforeHook = createAuthMiddleware(async (ctx) => {
  const path = ctx.path ?? ''
  const body = ctx.body as Record<string, unknown> | undefined

  // --- Turnstile verification ---
  const turnstileAction = TURNSTILE_PATHS[path]
  if (turnstileAction) {
    const token = body?.turnstileToken
    const ip = ctx.request ? getClientIp(ctx.request.headers) : null
    try {
      await verifyTurnstile(typeof token === 'string' ? token : '', { action: turnstileAction, ip })
    } catch (err) {
      if (err instanceof TurnstileError) {
        throw new APIError('BAD_REQUEST', { message: err.message, code: 'TURNSTILE_FAILED' })
      }
      throw err
    }
  }

  // --- Consent check for /sign-up/email ---
  if (path === '/sign-up/email') {
    if (body?.agreeTerms !== true || body?.agreePrivacy !== true) {
      throw new APIError('BAD_REQUEST', { message: 'Missing required consent', code: 'CONSENT_REQUIRED' })
    }
  }

  // --- Signup cap check for /sign-up/email (applies to both new and duplicate emails, employers skipped) ---
  if (path === '/sign-up/email' && !isEmployerRegistration()) {
    try {
      await assertStudentSignupOpen()
    } catch (err) {
      if (err instanceof SignupClosedError) {
        throw new APIError('FORBIDDEN', { message: err.message, code: err.code })
      }
      throw err
    }
  }

  // --- Force revokeOtherSessions for /change-password regardless of client input ---
  if (path === '/change-password' && typeof body === 'object' && body !== null) {
    ;(body as Record<string, unknown>).revokeOtherSessions = true
  }
})

// Trusted origins: APP_URL always, plus localhost only in development
const trustedOrigins = [env.APP_URL]
if (env.APP_ENV === 'development') {
  trustedOrigins.push('http://localhost:3000')
}

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins,

  database: prismaAdapter(db, { provider: 'postgresql' }),

  // Endpoints with no UI caller are disabled so they return 404.
  // See DECISIONS for the rationale on each path.
  disabledPaths: [
    '/sign-in/email-otp',
    '/email-otp/request-password-reset',
    '/forget-password/email-otp',
    '/email-otp/reset-password',
    '/email-otp/check-verification-otp',
    '/email-otp/verify-email',
  ],

  // Connect Better Auth's internal logger to the app logger (suppresses raw messages in prod)
  logger: {
    level: 'warn' as const,
    log: (level: string, message: string) => {
      if (level === 'error') {
        logger.error({ code: 'BETTER_AUTH_ERROR' }, `[better-auth] ${message}`)
      } else if (level === 'warn') {
        logger.warn({}, `[better-auth] ${message}`)
      } else {
        logger.info({}, `[better-auth] ${message}`)
      }
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    // Automatically revoke all sessions when password is reset
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      after(async () => {
        await emailProvider
          .sendEmail({
            to: user.email,
            subject: 'Reset your FindMYJob password',
            html: `<p>Click <a href="${url}">here</a> to reset your password. The link expires in 1 hour.</p>`,
            text: `Reset your password: ${url}`,
          })
          .catch((err: unknown) => {
            // Suppress SMTP error details to avoid leaking recipient email in logs
            logger.warn({ code: 'EMAIL_SEND_FAILED' }, 'Failed to send reset-password email')
            void err
          })
      })
    },
    // Sends a reminder when someone tries to sign up with an already-registered email.
    onExistingUserSignUp: async ({ user }: { user: { email: string } }) => {
      after(async () => {
        await emailProvider
          .sendEmail({
            to: user.email,
            subject: 'Someone tried to register with your FindMYJob account',
            html: `<p>Someone attempted to create a FindMYJob account using your email address. If this was you, please <a href="${env.APP_URL}/login">log in</a> instead.</p>`,
            text: `Someone attempted to create a FindMYJob account using your email address. If this was you, please log in instead.`,
          })
          .catch(() => {})
      })
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      after(async () => {
        await emailProvider
          .sendEmail({
            to: user.email,
            subject: 'Verify your FindMYJob account',
            html: `<p>Click <a href="${url}">here</a> to verify your email address.</p>`,
            text: `Verify your email: ${url}`,
          })
          .catch((err: unknown) => {
            logger.warn({ code: 'EMAIL_SEND_FAILED' }, 'Failed to send verification email')
            void err
          })
      })
    },
    // Call maybeWarnCap after a student verifies their email
    afterEmailVerification: async (user: { id: string; name: string; email: string; emailVerified: boolean; createdAt: Date; updatedAt: Date; image?: string | null }) => {
      const u = user as { id: string; role?: string }
      if (u.role === 'STUDENT') {
        await maybeWarnCap().catch(() => {})
      }
    },
  },

  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        // input:false prevents clients from setting this field directly
        input: false,
        fieldName: 'role',
        defaultValue: 'STUDENT',
      },
      locale: {
        type: 'string',
        required: false,
        input: false,
        fieldName: 'locale',
        defaultValue: 'zh',
      },
      status: {
        type: 'string',
        required: false,
        // input:false prevents clients from setting this field directly
        input: false,
        fieldName: 'status',
        defaultValue: 'ACTIVE',
      },
    },
  },

  session: {
    // cookieCache disabled per ARCHITECTURE §5.11
    cookieCache: { enabled: false },
  },

  advanced: {
    // useSecureCookies: only in production (staging uses https but APP_ENV=staging, not production)
    useSecureCookies: env.APP_ENV === 'production',
    // disableCSRFCheck is intentionally NOT set (CSRF protection stays enabled)
    // ipAddress: read only from x-real-ip (set by Caddy); X-Forwarded-For can be spoofed
    ipAddress: {
      ipAddressHeaders: ['x-real-ip'],
    },
    // backgroundTasks: use next/server after() so email sending doesn't block the response
    backgroundTasks: {
      handler: (promise: Promise<unknown>) => { after(() => promise) },
    },
  },

  rateLimit: {
    // Explicitly enabled; database storage persists counts across restarts (DECISIONS A24)
    enabled: true,
    storage: 'database',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/email-otp/send-verification-otp': { window: 60, max: 3 },
      '/request-password-reset': { window: 60, max: 3 },
      '/send-verification-email': { window: 60, max: 3 },
    },
  },

  plugins: [
    emailOTP({
      sendVerificationOTP: async ({ email, otp }) => {
        after(async () => {
          await emailProvider
            .sendEmail({
              to: email,
              subject: 'Your FindMYJob verification code',
              html: `<p>Your verification code is: <strong>${otp}</strong></p><p>It expires in 10 minutes.</p>`,
              text: `Your verification code is: ${otp}. It expires in 10 minutes.`,
            })
            .catch((err: unknown) => {
              logger.warn({ code: 'EMAIL_SEND_FAILED' }, 'Failed to send OTP email')
              void err
            })
        })
      },
      expiresIn: 600,
      allowedAttempts: 5,
      otpLength: 6,
      // disableSignUp prevents /sign-in/email-otp from creating users without consent
      disableSignUp: true,
      storeOTP: 'hashed',
    }),
  ],

  hooks: {
    before: beforeHook,
  },

  databaseHooks: {
    user: {
      create: {
        // Set employer role directly in the INSERT; avoids a separate UPDATE after user creation.
        before: async (data) => {
          if (isEmployerRegistration()) {
            return { data: { ...data, role: 'EMPLOYER' } }
          }
        },
        // Create Consent and StudentProfile from the sign-up request body.
        // This hook runs for every real user creation (not for the anti-enum fake user),
        // so it covers both UI-initiated and direct API registrations.
        after: async (user: Record<string, unknown>, ctx?: any) => {
          if (!user?.id) return
          const body = ctx?.body as Record<string, unknown> | undefined
          const isEmployer = isEmployerRegistration()
          const legalVersion = await getSetting<string>('legal.currentVersion', '1.0')
          const reqHeaders: Headers | null = ctx?.request?.headers ?? null
          const ip = reqHeaders ? getClientIp(reqHeaders as Headers) : null
          const userAgent = reqHeaders ? (reqHeaders as unknown as Headers).get('user-agent') : null
          const userId = user.id as string

          if (!isEmployer) {
            const joinTalentPool = body?.joinTalentPool === true
            const fullName = ((body?.name as string) ?? (user.name as string) ?? '').trim()
            await db.$transaction([
              db.studentProfile.create({
                data: {
                  userId,
                  fullName,
                  visibility: joinTalentPool ? 'PUBLIC' : 'HIDDEN',
                },
              }),
              db.consent.createMany({
                data: [
                  { userId, type: 'TERMS', granted: true, version: legalVersion, ip, userAgent },
                  { userId, type: 'PRIVACY', granted: true, version: legalVersion, ip, userAgent },
                  { userId, type: 'TALENT_POOL', granted: joinTalentPool, version: legalVersion, ip, userAgent },
                ],
              }),
            ])
          } else {
            await recordConsents(
              userId,
              [
                { type: 'TERMS', granted: true },
                { type: 'PRIVACY', granted: true },
              ],
              { ip, userAgent },
            )
          }
        },
      },
    },
    session: {
      create: {
        // Reject session creation for non-ACTIVE users (suspended/deleted accounts)
        before: async (data) => {
          const user = await db.user.findUnique({
            where: { id: data.userId },
            select: { status: true },
          })
          if (!user || user.status !== 'ACTIVE') {
            throw new APIError('FORBIDDEN', { message: 'Account suspended', code: 'ACCOUNT_SUSPENDED' })
          }
        },
        after: async (session) => {
          if (!session.userId) return
          // Use session.ipAddress which Better Auth populates from x-real-ip (via advanced.ipAddress)
          const ip = session.ipAddress ?? undefined
          await Promise.all([
            db.user.update({
              where: { id: session.userId },
              data: { lastLoginAt: new Date() },
            }),
            logAudit({
              actorId: session.userId,
              action: 'auth.login',
              targetType: 'User',
              targetId: session.userId,
              ip,
            }),
          ])
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session

export async function getSession(headers: Headers) {
  return auth.api.getSession({ headers })
}
