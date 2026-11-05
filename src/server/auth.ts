import 'server-only'
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
import { assertStudentSignupOpen } from './services/signup-cap'
import { isEmployerRegistration } from './lib/employer-registration-context'
import { SignupClosedError } from './errors'

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
})

const trustedOrigins = [env.APP_URL]
if (env.APP_ENV !== 'production') {
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
  ],

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    onPasswordReset: async ({ user }) => {
      await db.session.deleteMany({ where: { userId: user.id } })
    },
    sendResetPassword: async ({ user, url }) => {
      await emailProvider.sendEmail({
        to: user.email,
        subject: 'Reset your FindMYJob password',
        html: `<p>Click <a href="${url}">here</a> to reset your password. The link expires in 1 hour.</p>`,
        text: `Reset your password: ${url}`,
      })
    },
    // Sends a reminder when someone tries to sign up with an already-registered email.
    onExistingUserSignUp: async ({ user }: { user: { email: string } }) => {
      await emailProvider
        .sendEmail({
          to: user.email,
          subject: 'Someone tried to register with your FindMYJob account',
          html: `<p>Someone attempted to create a FindMYJob account using your email address. If this was you, please <a href="${env.APP_URL}/login">log in</a> instead.</p>`,
          text: `Someone attempted to create a FindMYJob account using your email address. If this was you, please log in instead.`,
        })
        .catch(() => {
          // Suppress send errors; anti-enum response is already returned
        })
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await emailProvider.sendEmail({
        to: user.email,
        subject: 'Verify your FindMYJob account',
        html: `<p>Click <a href="${url}">here</a> to verify your email address.</p>`,
        text: `Verify your email: ${url}`,
      })
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
    // useSecureCookies: only in production
    useSecureCookies: env.APP_ENV === 'production',
    // disableCSRFCheck is intentionally NOT set (CSRF protection stays enabled)
  },

  rateLimit: {
    // Database storage persists counts across restarts (DECISIONS A24)
    storage: 'database',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/email-otp/send-verification-otp': { window: 60, max: 3 },
      '/request-password-reset': { window: 60, max: 3 },
      '/send-verification-email': { window: 60, max: 3 },
    },
    ipAddressHeaders: ['x-real-ip'],
  },

  plugins: [
    emailOTP({
      sendVerificationOTP: async ({ email, otp }) => {
        await emailProvider.sendEmail({
          to: email,
          subject: 'Your FindMYJob verification code',
          html: `<p>Your verification code is: <strong>${otp}</strong></p><p>It expires in 10 minutes.</p>`,
          text: `Your verification code is: ${otp}. It expires in 10 minutes.`,
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
      },
    },
    session: {
      create: {
        after: async (session) => {
          if (!session.userId) return
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
