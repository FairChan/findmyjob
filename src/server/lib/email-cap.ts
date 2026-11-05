import 'server-only'
import { getSetting } from '../services/settings'
import { alert } from './alert'
import { hitBucket } from './db-rate-limit'

const EMAIL_CAP_KEY = 'email:daily'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

// Closed whitelist: only these template names bypass the daily cap.
const CRITICAL_TEMPLATES = new Set(['otp', 'password-reset', 'email-verify'])

/**
 * Check whether a non-critical email can be sent.
 * Template names in CRITICAL_TEMPLATES always bypass the cap.
 * Returns true if the email should be sent, false if it should be suppressed.
 * Increments the daily counter atomically in the database.
 * Fires one alert per window when the cap is first exceeded (count === cap+1).
 */
export async function checkEmailCap(opts: { template: string }): Promise<boolean> {
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

export { CRITICAL_TEMPLATES }
