import 'server-only'
import { getSetting } from '../services/settings'
import { alert } from './alert'
import { hitBucket } from './db-rate-limit'

const EMAIL_CAP_KEY = 'email:daily'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** Closed registry of all valid email template names. Add new templates here. */
export const EMAIL_TEMPLATES = {
  'otp': 'one-time password',
  'email-verify': 'email verification',
  'password-reset': 'password reset',
  'welcome': 'welcome email',
  'job-alert': 'job alert notification',
  'invitation': 'platform invitation',
  'newsletter': 'newsletter',
} as const

export type EmailTemplate = keyof typeof EMAIL_TEMPLATES

// Compile-time guarantee: every entry must be a valid EmailTemplate.
const CRITICAL_TEMPLATE_NAMES = ['otp', 'password-reset', 'email-verify'] as const satisfies readonly EmailTemplate[]

/** Templates that always bypass the daily email cap. Derived from EMAIL_TEMPLATES constant. */
export const CRITICAL_TEMPLATES = new Set<EmailTemplate>(CRITICAL_TEMPLATE_NAMES)

/**
 * Check whether a non-critical email can be sent.
 * Template names in CRITICAL_TEMPLATES always bypass the cap.
 * Returns true if the email should be sent, false if it should be suppressed.
 * Increments the daily counter atomically in the database.
 * Fires one alert per window when the cap is first exceeded (count === cap+1).
 */
export async function checkEmailCap(opts: { template: EmailTemplate }): Promise<boolean> {
  if (CRITICAL_TEMPLATES.has(opts.template)) return true

  const cap = await getSetting<number>('email.dailyCap', 500)
  const result = await hitBucket(EMAIL_CAP_KEY, { windowMs: ONE_DAY_MS, limit: cap })

  if (!result.allowed) {
    // Alert ops exactly once per window: only when count just crossed the threshold.
    if (result.count === cap + 1) {
      alert('email.dailyCap.reached', { cap, resetAt: new Date(result.resetAt).toISOString() })
    }
    return false
  }

  return true
}
