import 'server-only'

// In-memory sliding window rate limiter. Resets on process restart — this is
// acceptable during the single-instance pilot phase (A24).

export interface RateLimitOptions {
  windowMs: number
  limit: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  /** Unix ms at which the oldest token expires and a new request would be allowed */
  resetAt: number
}

const store = new Map<string, number[]>()

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const cutoff = now - opts.windowMs
  const timestamps = (store.get(key) ?? []).filter((t) => t > cutoff)

  if (timestamps.length >= opts.limit) {
    store.set(key, timestamps)
    return {
      allowed: false,
      remaining: 0,
      resetAt: timestamps[0] + opts.windowMs,
    }
  }

  timestamps.push(now)
  store.set(key, timestamps)
  return {
    allowed: true,
    remaining: opts.limit - timestamps.length,
    resetAt: now + opts.windowMs,
  }
}

/** Remove all entries for a key (useful in tests or on sign-out). */
export function clearRateLimit(key: string): void {
  store.delete(key)
}
