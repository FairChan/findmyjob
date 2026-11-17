import 'server-only'
import { after } from 'next/server'
import { betterAuth } from 'better-auth'
import { createAuthMiddleware, APIError, getSessionFromCtx, setShouldSkipSessionRefresh } from 'better-auth/api'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { expo } from '@better-auth/expo'
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
import { alert } from './lib/alert'
import { verificationEmailContent } from './lib/verification-email'
import { isAppOriginRequest, parseAppOrigins } from './lib/app-origin'
import { isPlayIntegrityConfigured, PlayIntegrityError, verifyPlayIntegrity } from './lib/play-integrity'
import { findUnsafeCallbackUrl } from './lib/auth-callback-url'

const emailProvider = createEmailProvider()
const emailVerificationProvider = createEmailProvider({
  provider: env.EMAIL_VERIFICATION_PROVIDER,
  apiKey: env.EMAIL_VERIFICATION_RESEND_API_KEY,
  from: env.EMAIL_VERIFICATION_FROM,
})

// Wraps after() with a fallback for non-request contexts (worker, scripts, tests that don't mock next/server).
function sendEmailAfterResponse(fn: () => Promise<void>): void {
  try {
    after(fn)
  } catch {
    void fn()
  }
}

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

  // --- Callback URLs must stay on the web (MA1-T02) ---
  // The Expo plugin copies Set-Cookie into custom-scheme redirect URLs; another app that claims
  // the same scheme could read the session from that URL. The Android app never sends one.
  if (findUnsafeCallbackUrl(body)) {
    throw new APIError('BAD_REQUEST', { message: 'Invalid callback URL', code: 'INVALID_CALLBACK_URL' })
  }

  // --- Turnstile verification ---
  const turnstileAction = TURNSTILE_PATHS[path]
  if (turnstileAction) {
    const token = body?.turnstileToken
    const integrityToken = body?.integrityToken
    const ip = ctx.request ? getClientIp(ctx.request.headers) : null
    // Android app (MA1-T03): a Play Integrity token stands in for Turnstile, but only on requests
    // from the configured app origin; the web keeps Turnstile. Same rate limits either way.
    const useIntegrity =
      typeof integrityToken === 'string' && integrityToken !== '' &&
      !!ctx.request && isAppOriginRequest(ctx.request.headers) && isPlayIntegrityConfigured()
    try {
      if (useIntegrity) {
        await verifyPlayIntegrity(integrityToken as string, {
          action: turnstileAction,
          email: typeof body?.email === 'string' ? body.email : '',
        })
      } else {
        await verifyTurnstile(typeof token === 'string' ? token : '', { action: turnstileAction, ip })
      }
    } catch (err) {
      if (err instanceof TurnstileError || err instanceof PlayIntegrityError) {
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

  // Enforce the absolute lifetime on Better Auth's endpoints, including legacy
  // seven-day sessions, while keeping credential-based recovery available.
  const recoveryPath = ['/sign-in/email', '/sign-out', '/request-password-reset', '/reset-password', '/reset-password/:token'].includes(path)
  const session = recoveryPath ? null : await getSessionFromCtx(ctx, { disableCookieCache: true, disableRefresh: true })
  if (session?.user.role === 'ADMIN') {
    const age = Date.now() - new Date(session.session.createdAt).getTime()
    if (!Number.isFinite(age) || age < 0 || age >= 12 * 3600_000) {
      throw new APIError('UNAUTHORIZED', { code: 'ADMIN_SESSION_EXPIRED', message: 'Admin session expired' })
    }
    // The global seven-day refresh calculation would otherwise write on every
    // twelve-hour admin session read. This flag is local to the current request.
    await setShouldSkipSessionRefresh(true)
  } else {
    // The probe must not change student/employer sliding-session behavior.
    ctx.context.session = null
  }

  // Enrollment is password-confirmed and requires an existing admin session.
  // Verification uses the plugin's signed challenge cookie after Turnstile-protected login.
  if (path === '/two-factor/enable') {
    const user = session && await db.user.findUnique({ where: { id: session.user.id }, select: { role: true, status: true } })
    if (!session || !user || user.role !== 'ADMIN' || user.status !== 'ACTIVE' ||
      Date.now() - new Date(session.session.createdAt).getTime() >= 12 * 3600_000) {
      throw new APIError('FORBIDDEN', { code: 'FORBIDDEN', message: 'Admin session required' })
    }
  }
  if (path.startsWith('/two-factor/') && body) {
    // Every admin login must complete its second factor; never issue trusted-device cookies.
    body.trustDevice = false
  }
})

// Trusted origins: APP_URL always, plus localhost only in development, plus this environment's
// exact Android app scheme (MOBILE_APP_ORIGINS, MA1-T02). Never a wildcard.
const trustedOrigins = [env.APP_URL, ...parseAppOrigins(env.MOBILE_APP_ORIGINS)]
if (env.APP_ENV === 'development') {
  trustedOrigins.push('http://localhost:3000')
}

async function writeSignupRecords(user: Record<string, unknown>, ctx?: any): Promise<void> {
  const body = ctx?.body as Record<string, unknown> | undefined
  const isEmployer = isEmployerRegistration()
  // Must match the same default as needsReconsent() in legal-consent.ts; a mismatch would
  // mean newly registered users always get redirected to reconsent on their first page load.
  const legalVersion = await getSetting<string>('legal.currentVersion', '2026-11-draft')
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
}

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins,

  database: prismaAdapter(db, { provider: 'postgresql' }),

  // Store verification identifiers (reset tokens, OTPs) as SHA-256 hashes; never plain text.
  verification: {
    storeIdentifier: 'hashed' as const,
  },

  // Endpoints with no UI caller are disabled so they return 404.
  // See DECISIONS for the rationale on each path.
  disabledPaths: [
    '/sign-in/email-otp',
    '/email-otp/request-password-reset',
    '/forget-password/email-otp',
    '/email-otp/reset-password',
    '/email-otp/check-verification-otp',
    '/email-otp/verify-email',
    // changeEmail plugin paths: not wired in UI; disable so they don't route
    '/email-otp/request-email-change',
    '/email-otp/change-email',
    '/two-factor/disable',
    '/two-factor/get-totp-uri',
    '/two-factor/send-otp',
    '/two-factor/verify-otp',
    '/two-factor/generate-backup-codes',
    '/two-factor/view-backup-codes',
  ],

  // Connect Better Auth's internal logger to the app logger (suppresses raw messages in prod).
  // No `level` override — library default is warn, setting it explicitly causes APIErrors
  // to be double-logged via the default console logger.
  // Extra args from BA are wrapped in an array; extract only {code, status} to avoid
  // leaking PII that may be embedded in error details or email addresses.
  logger: {
    log: (level: string, message: string, ...args: unknown[]) => {
      const safe: Record<string, unknown> = {}
      for (const arg of args) {
        if (arg && typeof arg === 'object') {
          const a = arg as Record<string, unknown>
          if ('code' in a) safe.code = a.code
          if ('status' in a) safe.status = a.status
        }
      }
      if (level === 'error') {
        logger.error({ code: 'BETTER_AUTH_ERROR', ...safe }, `[better-auth] ${message}`)
      } else if (level === 'warn') {
        logger.warn(safe, `[better-auth] ${message}`)
      } else {
        logger.info(safe, `[better-auth] ${message}`)
      }
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    // Automatically revoke all sessions when password is reset
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      sendEmailAfterResponse(async () => {
        await emailProvider
          .sendEmail({
            to: user.email,
            subject: 'Reset your FindMYJob password',
            html: `<p>Click <a href="${url}">here</a> to reset your password. The link expires in 1 hour.</p>`,
            text: `Reset your password: ${url}`,
          })
          .catch((err: unknown) => {
            const code = (err as NodeJS.ErrnoException)?.code ?? 'EMAIL_SEND_FAILED'
            logger.warn({ code }, 'Failed to send reset-password email')
            alert('email.send.failed', { code })
          })
      })
    },
    // Sends a reminder when someone tries to sign up with an already-registered email.
    // Uses renderEmailTemplate with the user's locale (zh/en).
    onExistingUserSignUp: async ({ user }: { user: { email: string } }) => {
      sendEmailAfterResponse(async () => {
        const { sendExistingUserReminder } = await import('./services/notify')
        await sendExistingUserReminder(user.email)
      })
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      sendEmailAfterResponse(async () => {
        await emailVerificationProvider
          .sendEmail({
            to: user.email,
            ...verificationEmailContent(url),
          })
          .catch((err: unknown) => {
            const code = (err as NodeJS.ErrnoException)?.code ?? 'EMAIL_SEND_FAILED'
            logger.warn({ code }, 'Failed to send verification email')
            alert('email.send.failed', { code })
          })
      })
    },
    // Call maybeWarnCap after a student verifies their email
    afterEmailVerification: async (user: { id: string; name: string; email: string; emailVerified: boolean; createdAt: Date; updatedAt: Date; image?: string | null }) => {
      const u = user as { id: string; role?: string }
      if (u.role === 'STUDENT') {
        await maybeWarnCap().catch((err: unknown) => {
          logger.warn({ code: 'WARN_CAP_FAILED', err }, 'maybeWarnCap failed')
        })
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
    freshAge: 600,
    additionalFields: {
      twoFactorVerifiedAt: { type: 'date', required: false, input: false },
    },
    // cookieCache disabled per ARCHITECTURE §5.11
    cookieCache: { enabled: false },
  },

  advanced: {
    // useSecureCookies: true in production only; undefined (not false) elsewhere so that
    // staging (https but APP_ENV=staging) still gets Secure cookies from the browser/server defaults.
    useSecureCookies: env.APP_ENV === 'production' ? true : undefined,
    // disableCSRFCheck is intentionally NOT set (CSRF protection stays enabled)
    // ipAddress: read only from x-real-ip (set by Caddy); X-Forwarded-For can be spoofed
    ipAddress: {
      ipAddressHeaders: ['x-real-ip'],
    },
    // backgroundTasks: use next/server after() so internal BA tasks don't block the response
    backgroundTasks: {
      handler: (promise: Promise<unknown>) => {
        try {
          after(() => promise)
        } catch {
          void promise
        }
      },
    },
  },

  rateLimit: {
    // Explicitly enabled; production/staging use database storage (persists across restarts, DECISIONS A24 and the 2026-11-05 M1-T11 row).
    // Development/CI/test use memory storage (DECISIONS 2026-11-05 M1-T11 row); note Playwright reuses a running dev server, so local buckets persist until it restarts.
    enabled: true,
    storage: (env.APP_ENV === 'production' || env.APP_ENV === 'staging') ? 'database' : 'memory',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/email-otp/send-verification-otp': { window: 60, max: 3 },
      '/request-password-reset': { window: 60, max: 3 },
      '/send-verification-email': { window: 60, max: 3 },
      '/two-factor/enable': { window: 60, max: 5 },
      '/two-factor/verify-totp': { window: 60, max: 5 },
      '/two-factor/verify-backup-code': { window: 60, max: 5 },
    },
  },

  plugins: [
    // Android app sessions (MA0-T04): the app keeps Better Auth's cookies in SecureStore and sends
    // them with expo-origin; this plugin maps expo-origin to Origin only when the request has none,
    // so browser requests are unaffected. Chosen over the bearer plugin, which would expose the
    // session token in a set-auth-token header on web sign-ins too.
    expo(),
    twoFactor({
      issuer: 'FindMYJob',
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
      backupCodeOptions: { storeBackupCodes: 'encrypted' },
    }),
    emailOTP({
      sendVerificationOTP: async ({ email, otp }) => {
        sendEmailAfterResponse(async () => {
          await emailProvider
            .sendEmail({
              to: email,
              subject: 'Your FindMYJob verification code',
              html: `<p>Your verification code is: <strong>${otp}</strong></p><p>It expires in 10 minutes.</p>`,
              text: `Your verification code is: ${otp}. It expires in 10 minutes.`,
            })
            .catch((err: unknown) => {
              const code = (err as NodeJS.ErrnoException)?.code ?? 'EMAIL_SEND_FAILED'
              logger.warn({ code }, 'Failed to send OTP email')
              alert('email.send.failed', { code })
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
          // Only write signup records for the standard registration path.
          // Guards against admin plugins, social login, or scripts calling signUpEmail directly —
          // those would otherwise get "consent granted" records the user never saw.
          if (ctx?.path !== '/sign-up/email') return
          const ctxBody = ctx?.body as Record<string, unknown> | undefined
          if (ctxBody?.agreeTerms !== true || ctxBody?.agreePrivacy !== true) return
          // prismaAdapter 的 transaction 默认关闭：走到这里时 User 和 Account 已经提交、验证邮件也已排队。
          // 这里任何一步失败都把刚建的用户删掉（Account、Consent、StudentProfile 级联删除），不留没有同意记录的账号
          try {
            await writeSignupRecords(user, ctx)
          } catch (err) {
            await db.user.delete({ where: { id: user.id as string } }).catch(() => {})
            logger.error({ code: 'SIGNUP_RECORDS_FAILED', userId: user.id }, 'sign-up rolled back')
            throw err
          }
        },
      },
    },
    session: {
      create: {
        // Reject session creation for non-ACTIVE users (suspended/deleted accounts)
        before: async (data, ctx) => {
          const user = await db.user.findUnique({
            where: { id: data.userId },
            select: { status: true, role: true },
          })
          if (!user || user.status !== 'ACTIVE') {
            throw new APIError('FORBIDDEN', { message: 'Account suspended', code: 'ACCOUNT_SUSPENDED' })
          }
          const verified = ctx?.path === '/two-factor/verify-totp' || ctx?.path === '/two-factor/verify-backup-code'
          const now = new Date()
          return { data: {
            ...data,
            twoFactorVerifiedAt: verified ? now : null,
            ...(user.role === 'ADMIN' ? { expiresAt: new Date(Math.min(data.expiresAt.getTime(), new Date(data.createdAt).getTime() + 12 * 3600_000)) } : {}),
          } }
        },
        after: async (session, ctx?: any) => {
          if (!session.userId) return
          // Sessions created during /change-password are not new logins.
          const path: string = ctx?.path ?? ''
          if (path === '/change-password') return
          // The plugin discards this provisional password session when a second factor is required.
          if (path === '/sign-in/email') {
            const user = await db.user.findUnique({ where: { id: session.userId }, select: { twoFactorEnabled: true } })
            if (user?.twoFactorEnabled) return
          }
          // Prefer ctx.headers (top-level in newer BA versions) before ctx.request.headers.
          // session.ipAddress may be empty string or a /64-truncated IPv6 depending on BA version.
          const reqHeaders: Headers | undefined = ctx?.headers ?? ctx?.request?.headers
          const ip = reqHeaders
            ? (getClientIp(reqHeaders as Headers) ?? undefined)
            : (session.ipAddress ?? undefined)
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
      update: {
        before: async (data, ctx) => {
          const active = ctx?.context.session
          if (!active || !data.expiresAt) return
          const user = await db.user.findUnique({ where: { id: active.user.id }, select: { role: true } })
          if (user?.role !== 'ADMIN') return
          return { data: {
            ...data,
            expiresAt: new Date(Math.min(new Date(data.expiresAt).getTime(), new Date(active.session.createdAt).getTime() + 12 * 3600_000)),
          } }
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session

export async function getSession(headers: Headers) {
  try {
    return await auth.api.getSession({ headers })
  } catch (error) {
    if (error instanceof APIError && error.body?.code === 'ADMIN_SESSION_EXPIRED') return null
    throw error
  }
}
