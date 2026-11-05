import 'server-only'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { db } from './db'
import { env } from '@/env'
import { createEmailProvider } from '@/lib/email'

const emailProvider = createEmailProvider()

const trustedOrigins = [env.APP_URL]
if (env.APP_ENV !== 'production') {
  trustedOrigins.push('http://localhost:3000')
}

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins,

  database: prismaAdapter(db, { provider: 'postgresql' }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    // Revoke all sessions on password reset (server-side enforced, ARCHITECTURE §5.11)
    onPasswordReset: async ({ user }) => {
      await db.session.deleteMany({ where: { userId: user.id } })
    },
    // Send password-reset email link
    sendResetPassword: async ({ user, url }) => {
      await emailProvider.sendEmail({
        to: user.email,
        subject: 'Reset your FindMYJob password',
        html: `<p>Click <a href="${url}">here</a> to reset your password. The link expires in 1 hour.</p>`,
        text: `Reset your password: ${url}`,
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
      disableSignUp: false,
      storeOTP: 'hashed',
    }),
  ],
})

export type Session = typeof auth.$Infer.Session

export async function getSession(headers: Headers) {
  return auth.api.getSession({ headers })
}
