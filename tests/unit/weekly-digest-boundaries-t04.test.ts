import { describe, expect, it, vi } from 'vitest'
vi.mock('@/env', () => ({ env: { MARKETING_UNSUBSCRIBE_SECRET: 't'.repeat(48) } }))
import { getWeeklyDigestWindow, weeklyDigestKey } from '@/server/lib/weekly-digest'
import { createMarketingUnsubscribeToken, verifyMarketingUnsubscribeToken } from '@/server/lib/marketing-unsubscribe'

describe('M9-T04 calendar, dedupe and unsubscribe boundaries', () => {
  it.each([
    ['2026-11-08T15:59:59.999Z', '2026-11-02'],
    ['2026-11-08T16:00:00.000Z', '2026-11-09'],
    ['2027-01-03T16:00:00.000Z', '2027-01-04'],
  ])('assigns %s to KL calendar week %s', (iso, weekKey) => {
    const window = getWeeklyDigestWindow(new Date(iso))
    expect(window.weekKey).toBe(weekKey)
    expect(window.startsAt.toISOString().slice(11)).toBe('16:00:00.000Z')
    expect(window.expiresAt.getTime() - window.startsAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
    expect(new Date(iso).getTime()).toBeGreaterThanOrEqual(window.startsAt.getTime())
    expect(new Date(iso).getTime()).toBeLessThan(window.expiresAt.getTime())
  })
  it('deduplicates one cohort and separates user, company, kind and week', () => {
    const input = { kind: 'STUDENT_JOBS' as const, userId: 'c1111111111111111111111111', companyId: null, weekKey: '2026-11-09' }
    const key = weeklyDigestKey(input)
    expect(weeklyDigestKey({ ...input })).toBe(key)
    const variants = [
      { ...input, userId: 'c2222222222222222222222222' },
      { ...input, weekKey: '2026-11-16' },
      { ...input, kind: 'EMPLOYER_TALENTS' as const, companyId: 'c3333333333333333333333333' },
      { ...input, kind: 'EMPLOYER_TALENTS' as const, companyId: 'c4444444444444444444444444' },
    ]
    expect(new Set([key, ...variants.map(weeklyDigestKey)]).size).toBe(5)
  })
  it('binds an unsubscribe token to one user and rejects signature/payload changes', () => {
    const userId = 'c1111111111111111111111111'
    const token = createMarketingUnsubscribeToken(userId)
    expect(verifyMarketingUnsubscribeToken(token)).toEqual({ userId })
    const mutated = (token[0] === 'A' ? 'B' : 'A') + token.slice(1)
    expect(verifyMarketingUnsubscribeToken(mutated)).toBeNull()
    expect(verifyMarketingUnsubscribeToken(token + 'x')).toBeNull()
    expect(token).not.toContain('@')
  })
  it.each(['', 'x'.repeat(4097)])('fails closed for malformed or oversized token', token => {
    expect(verifyMarketingUnsubscribeToken(token)).toBeNull()
  })
})
