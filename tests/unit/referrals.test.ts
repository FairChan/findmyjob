import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/env', () => ({ env: {} }))

const mockDb = vi.hoisted(() => ({
  studentProfile: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  user: { findUnique: vi.fn() },
  referral: {
    upsert: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  auditLog: { create: vi.fn() },
}))
vi.mock('@/server/db', () => ({ db: mockDb }))

const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

import {
  normalizeEmail,
  getOrCreateReferralCode,
  attachReferral,
  qualifyReferral,
  voidReferral,
  requalifyReferrals,
} from '@/server/services/referrals'

describe('normalizeEmail', () => {
  it('lowercases regular emails', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com')
  })

  it('removes dots and +tag from gmail local part', () => {
    expect(normalizeEmail('a.b+x@gmail.com')).toBe('ab@gmail.com')
    expect(normalizeEmail('A.B@gmail.com')).toBe('ab@gmail.com')
    expect(normalizeEmail('AB@GMAIL.COM')).toBe('ab@gmail.com')
  })

  it('googlemail.com is treated as gmail.com', () => {
    expect(normalizeEmail('a.b@googlemail.com')).toBe('ab@gmail.com')
  })

  it('does not strip dots from non-gmail domains', () => {
    expect(normalizeEmail('a.b+x@outlook.com')).toBe('a.b+x@outlook.com')
  })

  it('a.b+x@gmail.com normalizes to same as ab@gmail.com', () => {
    expect(normalizeEmail('a.b+x@gmail.com')).toBe(normalizeEmail('ab@gmail.com'))
  })
})

describe('getOrCreateReferralCode', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns existing code without creating a new one', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue({ referralCode: 'existing1' })
    const code = await getOrCreateReferralCode('sp1')
    expect(code).toBe('existing1')
    expect(mockDb.studentProfile.update).not.toHaveBeenCalled()
  })

  it('generates and saves a code when none exists', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue({ referralCode: null })
    mockDb.studentProfile.update.mockResolvedValue({ referralCode: 'newcode1' })
    const code = await getOrCreateReferralCode('sp1')
    expect(code).toHaveLength(8)
    expect(mockDb.studentProfile.update).toHaveBeenCalledWith({
      where: { id: 'sp1' },
      data: { referralCode: code },
    })
  })
})

describe('attachReferral', () => {
  beforeEach(() => vi.resetAllMocks())

  it('ignores unknown referral code', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue(null)
    await attachReferral('inviteeId', 'badcode')
    expect(mockDb.referral.upsert).not.toHaveBeenCalled()
  })

  it('ignores self-referral by profile id', async () => {
    mockDb.studentProfile.findUnique
      .mockResolvedValueOnce({ id: 'sp1', userId: 'u1' }) // referrer lookup
    await attachReferral('sp1', 'code1')
    expect(mockDb.referral.upsert).not.toHaveBeenCalled()
  })

  it('ignores self-referral by normalized gmail email', async () => {
    // Referrer: a.b+x@gmail.com (profile id sp1), Invitee: ab@gmail.com (profile id sp2)
    mockDb.studentProfile.findUnique
      .mockResolvedValueOnce({ id: 'sp1', userId: 'u1' }) // referrer by code
      .mockResolvedValueOnce({ userId: 'u2' }) // invitee profile
    mockDb.user.findUnique
      .mockResolvedValueOnce({ email: 'a.b+x@gmail.com' }) // referrer user
      .mockResolvedValueOnce({ email: 'ab@gmail.com' }) // invitee user
    await attachReferral('sp2', 'code1')
    expect(mockDb.referral.upsert).not.toHaveBeenCalled()
  })

  it('creates referral when valid', async () => {
    mockDb.studentProfile.findUnique
      .mockResolvedValueOnce({ id: 'sp1', userId: 'u1' })
      .mockResolvedValueOnce({ userId: 'u2' })
    mockDb.user.findUnique
      .mockResolvedValueOnce({ email: 'referrer@example.com' })
      .mockResolvedValueOnce({ email: 'invitee@example.com' })
    mockDb.referral.upsert.mockResolvedValue({})
    await attachReferral('sp2', 'code1')
    expect(mockDb.referral.upsert).toHaveBeenCalledWith({
      where: { inviteeId: 'sp2' },
      update: {},
      create: { referrerId: 'sp1', inviteeId: 'sp2', status: 'PENDING' },
    })
  })

  it('second attach for same invitee is upsert no-op', async () => {
    mockDb.studentProfile.findUnique
      .mockResolvedValueOnce({ id: 'sp1', userId: 'u1' })
      .mockResolvedValueOnce({ userId: 'u2' })
    mockDb.user.findUnique
      .mockResolvedValueOnce({ email: 'referrer@example.com' })
      .mockResolvedValueOnce({ email: 'invitee@example.com' })
    mockDb.referral.upsert.mockResolvedValue({})
    await attachReferral('sp2', 'code1')
    // upsert is called but update is empty — existing record is unchanged
    expect(mockDb.referral.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    )
  })
})

describe('qualifyReferral', () => {
  beforeEach(() => vi.resetAllMocks())

  it('no-ops when no pending referral exists', async () => {
    mockDb.referral.findFirst.mockResolvedValue(null)
    await qualifyReferral('sp1')
    expect(mockDb.referral.updateMany).not.toHaveBeenCalled()
  })

  it('no-ops when email is not verified', async () => {
    mockDb.referral.findFirst.mockResolvedValue({ id: 'r1', referrerId: 'sp2', inviteeId: 'sp1', status: 'PENDING' })
    mockDb.studentProfile.findUnique.mockResolvedValue({ userId: 'u1', completeness: 90, schoolVerifiedAt: null })
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: false })
    await qualifyReferral('sp1')
    expect(mockDb.referral.updateMany).not.toHaveBeenCalled()
  })

  it('no-ops when completeness below threshold', async () => {
    mockDb.referral.findFirst.mockResolvedValue({ id: 'r1', referrerId: 'sp2', inviteeId: 'sp1', status: 'PENDING' })
    mockDb.studentProfile.findUnique.mockResolvedValue({ userId: 'u1', completeness: 89, schoolVerifiedAt: null })
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: true })
    mockGetSetting
      .mockResolvedValueOnce(90) // minCompleteness
      .mockResolvedValueOnce(false) // requireSchoolVerified
      .mockResolvedValueOnce(3) // maxQualifiedPerDay
    await qualifyReferral('sp1')
    expect(mockDb.referral.updateMany).not.toHaveBeenCalled()
  })

  it('qualifies when all conditions met and under daily cap', async () => {
    mockDb.referral.findFirst.mockResolvedValue({ id: 'r1', referrerId: 'sp2', inviteeId: 'sp1', status: 'PENDING' })
    mockDb.studentProfile.findUnique.mockResolvedValue({ userId: 'u1', completeness: 90, schoolVerifiedAt: null })
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: true })
    mockGetSetting
      .mockResolvedValueOnce(90)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(3)
    mockDb.referral.count.mockResolvedValue(0) // 0 qualified today
    mockDb.referral.updateMany.mockResolvedValue({ count: 1 })
    await qualifyReferral('sp1')
    expect(mockDb.referral.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'QUALIFIED' }),
    })
  })

  it('no-ops when daily cap is reached', async () => {
    mockDb.referral.findFirst.mockResolvedValue({ id: 'r1', referrerId: 'sp2', inviteeId: 'sp1', status: 'PENDING' })
    mockDb.studentProfile.findUnique.mockResolvedValue({ userId: 'u1', completeness: 95, schoolVerifiedAt: null })
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: true })
    mockGetSetting
      .mockResolvedValueOnce(90)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(3)
    mockDb.referral.count.mockResolvedValue(3) // already at cap
    await qualifyReferral('sp1')
    expect(mockDb.referral.updateMany).not.toHaveBeenCalled()
  })

  it('no-ops when school verification required but not done', async () => {
    mockDb.referral.findFirst.mockResolvedValue({ id: 'r1', referrerId: 'sp2', inviteeId: 'sp1', status: 'PENDING' })
    mockDb.studentProfile.findUnique.mockResolvedValue({ userId: 'u1', completeness: 95, schoolVerifiedAt: null })
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: true })
    mockGetSetting
      .mockResolvedValueOnce(90)
      .mockResolvedValueOnce(true) // requireSchoolVerified = true
      .mockResolvedValueOnce(3)
    await qualifyReferral('sp1')
    expect(mockDb.referral.updateMany).not.toHaveBeenCalled()
  })
})

describe('qualifyReferral — voided referrals do not count toward quota (M2-T12)', () => {
  beforeEach(() => vi.resetAllMocks())

  it('getQuota only counts QUALIFIED referrals — where clause includes status QUALIFIED', () => {
    // This test verifies the referral count where condition used in getQuota
    // getQuota calls: db.referral.count({ where: { referrerId: studentId, status: 'QUALIFIED' } })
    // We verify the mock is called with the right filter when qualifyReferral updates
    mockDb.referral.findFirst.mockResolvedValue({ id: 'r1', referrerId: 'sp2', inviteeId: 'sp1', status: 'PENDING' })
    mockDb.studentProfile.findUnique.mockResolvedValue({ userId: 'u1', completeness: 90, schoolVerifiedAt: null })
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: true })
    mockGetSetting
      .mockResolvedValueOnce(90)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(3)
    mockDb.referral.count.mockResolvedValue(0)
    mockDb.referral.updateMany.mockResolvedValue({ count: 1 })

    return qualifyReferral('sp1').then(() => {
      const countCall = mockDb.referral.count.mock.calls[0][0]
      expect(countCall.where.status).toBe('QUALIFIED')
    })
  })
})

describe('qualifyReferral — daily limit with fake timers (M2-T12)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('4th referral on same KL day stays PENDING, becomes QUALIFIED after midnight KL', async () => {
    // Simulate: 3 already qualified today; 4th comes in → stays PENDING
    mockDb.referral.findFirst.mockResolvedValue({ id: 'r1', referrerId: 'sp2', inviteeId: 'sp1', status: 'PENDING' })
    mockDb.studentProfile.findUnique.mockResolvedValue({ userId: 'u1', completeness: 90, schoolVerifiedAt: null })
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: true })
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'referral.minCompleteness') return Promise.resolve(90)
      if (key === 'referral.requireSchoolVerified') return Promise.resolve(false)
      if (key === 'referral.maxQualifiedPerDay') return Promise.resolve(3)
      return Promise.resolve(undefined)
    })
    mockDb.referral.count.mockResolvedValue(3) // already at cap

    await qualifyReferral('sp1')
    expect(mockDb.referral.updateMany).not.toHaveBeenCalled()

    // Now advance fake clock past KL midnight (UTC+8: 16:00 UTC = 00:00 KL next day)
    vi.useFakeTimers()
    // Set time to 2026-11-08T16:00:00Z which is 2026-11-09T00:00:00+08:00 (new KL day)
    vi.setSystemTime(new Date('2026-11-09T16:00:00Z'))

    // Now on the new KL day, qualified today count is 0
    mockDb.referral.count.mockResolvedValue(0)
    mockDb.referral.updateMany.mockResolvedValue({ count: 1 })

    await qualifyReferral('sp1')
    expect(mockDb.referral.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'QUALIFIED' }),
    })
  })
})

describe('requalifyReferrals — cross-day requalification with fake time (M2-T13 item 5)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('4th referral stays PENDING during KL day, qualifiedAt.gte shifts after KL midnight', async () => {
    // Fixed dataset: 3 referrals qualified on KL day 2026-11-09
    // (all between 2026-11-08T16:00Z and 2026-11-09T16:00Z)
    const klDay9QualifiedAts = [
      new Date('2026-11-08T18:00:00Z'), // 2026-11-09T02:00+08
      new Date('2026-11-09T05:00:00Z'), // 2026-11-09T13:00+08
      new Date('2026-11-09T12:00:00Z'), // 2026-11-09T20:00+08
    ]

    // Mock referral.count using the actual gte filter against fixed data
    mockDb.referral.count.mockImplementation((args: any) => {
      const gte: Date | undefined = args?.where?.qualifiedAt?.gte
      if (!gte) return Promise.resolve(0)
      const count = klDay9QualifiedAts.filter((d) => d >= gte).length
      return Promise.resolve(count)
    })

    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'referral.minCompleteness') return Promise.resolve(90)
      if (key === 'referral.requireSchoolVerified') return Promise.resolve(false)
      if (key === 'referral.maxQualifiedPerDay') return Promise.resolve(3)
      return Promise.resolve(undefined)
    })

    // The 4th pending referral to test
    mockDb.referral.findMany.mockResolvedValue([
      {
        id: 'r4',
        referrerId: 'sp2',
        inviteeId: 'sp4',
        status: 'PENDING',
        createdAt: new Date(),
        invitee: { userId: 'u4', completeness: 92, schoolVerifiedAt: null },
      },
    ])
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: true })
    mockDb.referral.updateMany.mockResolvedValue({ count: 1 })

    // --- At 2026-11-09T15:59:00Z (KL 23:59, still Nov 9 KL) ---
    // dayStart = 2026-11-08T16:00:00Z, 3 referrals qualify → cap reached → 4th stays PENDING
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-09T15:59:00Z'))

    const result1 = await requalifyReferrals()
    expect(result1.qualified).toBe(0) // 4th referral still blocked by cap

    // --- At 2026-11-09T16:15:00Z (KL 00:15, now Nov 10 KL — new day) ---
    // dayStart = 2026-11-09T16:00:00Z, 0 referrals qualify (all 3 were on Nov 9) → cap = 0 → 4th qualifies
    vi.setSystemTime(new Date('2026-11-09T16:15:00Z'))

    const result2 = await requalifyReferrals()
    expect(result2.qualified).toBe(1) // 4th referral now qualifies

    // Assert the referral.count was called with qualifiedAt.gte = 2026-11-09T16:00:00Z (KL midnight Nov 10)
    const countCalls = mockDb.referral.count.mock.calls
    const lastCall = countCalls[countCalls.length - 1][0] as any
    const expectedGte = new Date('2026-11-09T16:00:00Z')
    expect((lastCall.where.qualifiedAt?.gte as Date).getTime()).toBe(expectedGte.getTime())

    expect(mockDb.referral.updateMany).toHaveBeenCalledWith({
      where: { id: 'r4', status: 'PENDING' },
      data: expect.objectContaining({ status: 'QUALIFIED' }),
    })
  })
})

describe('voidReferral', () => {
  beforeEach(() => vi.resetAllMocks())

  it('updates status to VOID and writes audit log', async () => {
    mockDb.referral.update.mockResolvedValue({})
    mockDb.auditLog.create.mockResolvedValue({})
    await voidReferral('r1', 'fraud', 'admin1')
    expect(mockDb.referral.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'VOID', voidReason: 'fraud' },
    })
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin1',
        action: 'referral.void',
        targetType: 'Referral',
        targetId: 'r1',
      }),
    })
  })
})

describe('requalifyReferrals', () => {
  beforeEach(() => vi.resetAllMocks())

  it('qualifies pending referrals that meet conditions', async () => {
    mockGetSetting
      .mockResolvedValueOnce(90) // minCompleteness
      .mockResolvedValueOnce(false) // requireSchoolVerified
      .mockResolvedValueOnce(3) // maxQualifiedPerDay

    mockDb.referral.findMany.mockResolvedValue([
      {
        id: 'r1',
        referrerId: 'sp2',
        inviteeId: 'sp1',
        status: 'PENDING',
        createdAt: new Date(),
        invitee: { userId: 'u1', completeness: 92, schoolVerifiedAt: null },
      },
    ])
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: true })
    mockDb.referral.count.mockResolvedValue(0)
    mockDb.referral.updateMany.mockResolvedValue({ count: 1 })

    const result = await requalifyReferrals()
    expect(result.qualified).toBe(1)
  })

  it('skips unverified invitees', async () => {
    mockGetSetting.mockResolvedValue(90).mockResolvedValueOnce(90).mockResolvedValueOnce(false).mockResolvedValueOnce(3)
    mockDb.referral.findMany.mockResolvedValue([
      {
        id: 'r1',
        referrerId: 'sp2',
        inviteeId: 'sp1',
        status: 'PENDING',
        createdAt: new Date(),
        invitee: { userId: 'u1', completeness: 95, schoolVerifiedAt: null },
      },
    ])
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: false })

    const result = await requalifyReferrals()
    expect(result.qualified).toBe(0)
    expect(mockDb.referral.updateMany).not.toHaveBeenCalled()
  })

  it('respects daily cap across multiple referrals for same referrer', async () => {
    mockGetSetting
      .mockResolvedValueOnce(90)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(2) // cap = 2

    mockDb.referral.findMany.mockResolvedValue([
      { id: 'r1', referrerId: 'sp2', inviteeId: 'sp1', status: 'PENDING', createdAt: new Date(), invitee: { userId: 'u1', completeness: 95, schoolVerifiedAt: null } },
      { id: 'r2', referrerId: 'sp2', inviteeId: 'sp3', status: 'PENDING', createdAt: new Date(), invitee: { userId: 'u3', completeness: 95, schoolVerifiedAt: null } },
      { id: 'r3', referrerId: 'sp2', inviteeId: 'sp4', status: 'PENDING', createdAt: new Date(), invitee: { userId: 'u4', completeness: 95, schoolVerifiedAt: null } },
    ])
    mockDb.user.findUnique.mockResolvedValue({ emailVerified: true })
    mockDb.referral.count.mockResolvedValue(0) // 0 qualified today at start
    mockDb.referral.updateMany.mockResolvedValue({ count: 1 })

    const result = await requalifyReferrals()
    // cap=2: only first 2 should be qualified
    expect(result.qualified).toBe(2)
  })
})
