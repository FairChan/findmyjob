import { describe, it, expect } from 'vitest'
import { canViewJob, nextTier, pickDetail, qualifiedCount, recordJobView, viewLimit, type QuotaSettings, type Referral } from './quota'
import { fixtureJob } from '../test/fixtures'

const S: QuotaSettings = { enabled: true, baseJobViews: 20, tierSize: 3, tierBonus: 10, unlimitedAt: 12, referralMinCompleteness: 90 }

describe('quota', () => {
  it('viewLimit follows the tiers', () => {
    expect([0, 2, 3, 11].map((q) => viewLimit(q, 0, S))).toEqual([20, 20, 30, 50])
    expect(viewLimit(12, 0, S)).toBeNull()
    expect(viewLimit(0, 5, S)).toBe(25)
    expect(viewLimit(0, 0, { ...S, enabled: false })).toBeNull()
  })
  it('qualifiedCount counts only verified, >= 90, not void, distinct invitee', () => {
    let n = 0
    const r = (p: Partial<Referral>): Referral => ({ id: String(n++), inviteeId: 'x', inviteeName: '', completeness: 90, emailVerified: true, status: 'PENDING', createdAt: '', ...p })
    expect(qualifiedCount([
      r({ inviteeId: '1' }), r({ inviteeId: '2', completeness: 89 }), r({ inviteeId: '3', emailVerified: false }),
      r({ inviteeId: '4', status: 'VOID' }), r({ inviteeId: '1' }),
    ], S)).toBe(1)
  })
  it('nextTier tells how many more invites are needed', () => {
    expect(nextTier(4, S)).toEqual({ need: 2, bonus: 10 })
    expect(nextTier(11, S)).toEqual({ need: 1, bonus: 'UNLIMITED' })
    expect(nextTier(12, S)).toBeNull()
    expect(nextTier(0, { ...S, enabled: false })).toBeNull()
  })
  it('canViewJob allows applied and invited jobs when quota is exhausted', () => {
    const full = Array.from({ length: 20 }, (_, i) => `v${i}`)
    expect(canViewJob({ jobId: 'new', viewed: full, appliedJobIds: [], invitedJobIds: [], limit: 20 })).toBe(false)
    expect(canViewJob({ jobId: 'app', viewed: full, appliedJobIds: ['app'], invitedJobIds: [], limit: 20 })).toBe(true)
    expect(canViewJob({ jobId: 'inv', viewed: full, appliedJobIds: [], invitedJobIds: ['inv'], limit: 20 })).toBe(true)
    expect(canViewJob({ jobId: 'v3', viewed: full, appliedJobIds: [], invitedJobIds: [], limit: 20 })).toBe(true)
    expect(canViewJob({ jobId: 'new', viewed: full, appliedJobIds: [], invitedJobIds: [], limit: null })).toBe(true)
  })
  it('recordJobView is idempotent', () => {
    expect(recordJobView(['a'], 'a', true)).toEqual(['a'])
    expect(recordJobView(['a'], 'b', true)).toEqual(['a', 'b'])
    const same = ['a']
    expect(recordJobView(same, 'b', false)).toBe(same)
  })
  it('applied or invited jobs do not consume quota (PRD §2.5)', () => {
    const full = Array.from({ length: 20 }, (_, i) => `v${i}`)
    expect(recordJobView(full, 'app', true, true)).toBe(full)
    expect(recordJobView(full, 'app', true, true)).toHaveLength(20)
  })
  it('auto-selected job does not consume quota', () => {
    const list = [fixtureJob({ id: 'a' }), fixtureJob({ id: 'b' })]
    expect(pickDetail(list, null)).toEqual({ job: list[0], explicit: false })
    expect(pickDetail(list, 'b')).toEqual({ job: list[1], explicit: true })
    expect(pickDetail(list, 'gone')).toEqual({ job: list[0], explicit: false })
    expect(pickDetail([], null)).toEqual({ job: undefined, explicit: false })
  })
})
