import 'server-only'
import { getSetting } from '../services/settings'
import { alert } from './alert'
import { hitBucket } from './db-rate-limit'

const EMAIL_CAP_KEY = 'email:daily'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Check whether a non-critical email can be sent.
 * Critical emails (OTP, security alerts) always bypass the cap.
 * Returns true if the email should be sent, false if it should be suppressed.
 * Increments the daily counter atomically in the database.
 */
export async function checkEmailCap(opts: { critical: boolean }): Promise<boolean> {
  if (opts.critical) return true

  const cap = await getSetting<number>('email.dailyCap', 500)
  const result = await hitBucket(EMAIL_CAP_KEY, { windowMs: ONE_DAY_MS, limit: cap })

  if (!result.allowed) {
    // Alert ops: notify once per cap breach (Sentry deduplicates by fingerprint)
    alert('email.dailyCap.reached', { cap, resetAt: new Date(result.resetAt).toISOString() })
    return false
  }

  return true
}
