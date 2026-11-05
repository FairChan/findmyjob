import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, clearRateLimit } from '@/server/lib/rate-limit'

const KEY = 'test:rate-limit'
const OPTS = { windowMs: 1000, limit: 3 }

beforeEach(() => {
  clearRateLimit(KEY)
})

describe('checkRateLimit', () => {
  it('allows requests within the limit', () => {
    const r1 = checkRateLimit(KEY, OPTS)
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(2)

    const r2 = checkRateLimit(KEY, OPTS)
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(1)

    const r3 = checkRateLimit(KEY, OPTS)
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it('blocks requests that exceed the limit', () => {
    checkRateLimit(KEY, OPTS)
    checkRateLimit(KEY, OPTS)
    checkRateLimit(KEY, OPTS)

    const blocked = checkRateLimit(KEY, OPTS)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('provides a resetAt timestamp in the future when blocked', () => {
    checkRateLimit(KEY, OPTS)
    checkRateLimit(KEY, OPTS)
    checkRateLimit(KEY, OPTS)

    const blocked = checkRateLimit(KEY, OPTS)
    expect(blocked.resetAt).toBeGreaterThan(Date.now())
  })

  it('uses separate buckets for different keys', () => {
    clearRateLimit('key-a')
    clearRateLimit('key-b')

    checkRateLimit('key-a', OPTS)
    checkRateLimit('key-a', OPTS)
    checkRateLimit('key-a', OPTS)

    const r = checkRateLimit('key-b', OPTS)
    expect(r.allowed).toBe(true)

    clearRateLimit('key-a')
    clearRateLimit('key-b')
  })
})
