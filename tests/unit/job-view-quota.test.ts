import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/env', () => ({ env: {} }))

const mockDb = vi.hoisted(() => ({
  jobView: {
    count: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  referral: { count: vi.fn() },
  jobViewGrant: { aggregate: vi.fn() },
  application: { findFirst: vi.fn() },
  invitation: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/server/db', () => ({ db: mockDb }))

const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

const mockLockXact = vi.hoisted(() => vi.fn())
vi.mock('@/server/lib/advisory-locks', () => ({
  LOCK_NS: { JOB_VIEW_QUOTA: 1001 },
  lockXact: mockLockXact,
}))

import { getQuota, openJob } from '@/server/services/job-view-quota'

const defaults = {
  'studentQuota.enabled': true,
  'studentQuota.baseJobViews': 20,
  'studentQuota.tierSize': 3,
  'studentQuota.tierBonus': 10,
  'studentQuota.unlimitedAt': 12,
}

function setupSettings(overrides: Partial<typeof defaults> = {}) {
  const settings = { ...defaults, ...overrides }
  mockGetSetting.mockImplementation((key: string, def: unknown) => settings[key as keyof typeof settings] ?? def)
}

function setupTransactionInline() {
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<void>) => {
    await fn(mockDb)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setupSettings()
  setupTransactionInline()
  mockLockXact.mockResolvedValue(undefined)
  mockDb.application.findFirst.mockResolvedValue(null)
  mockDb.invitation.findFirst.mockResolvedValue(null)
  mockDb.jobView.findUnique.mockResolvedValue(null)
  mockDb.jobView.create.mockResolvedValue({})
  mockDb.jobViewGrant.aggregate.mockResolvedValue({ _sum: { amount: null } })
})

describe('getQuota', () => {
  it('returns base limit when no referrals and no grants', async () => {
    mockDb.jobView.count.mockResolvedValue(5)
    mockDb.referral.count.mockResolvedValue(0)
    mockDb.jobViewGrant.aggregate.mockResolvedValue({ _sum: { amount: null } })

    const q = await getQuota('s1')
    expect(q.used).toBe(5)
    expect(q.limit).toBe(20) // base = 20, no tiers
    expect(q.qualified).toBe(0)
    expect(q.next).toBe(3) // need 3 more to reach first tier
  })

  it('adds tier bonus for every tierSize qualified referrals', async () => {
    mockDb.jobView.count.mockResolvedValue(0)
    mockDb.referral.count.mockResolvedValue(3) // 1 full tier
    mockDb.jobViewGrant.aggregate.mockResolvedValue({ _sum: { amount: null } })

    const q = await getQuota('s1')
    expect(q.limit).toBe(30) // 20 + 10
    expect(q.next).toBe(3) // need 3 for next tier
  })

  it('adds grants on top of formula', async () => {
    mockDb.jobView.count.mockResolvedValue(0)
    mockDb.referral.count.mockResolvedValue(0)
    mockDb.jobViewGrant.aggregate.mockResolvedValue({ _sum: { amount: 5 } })

    const q = await getQuota('s1')
    expect(q.limit).toBe(25) // 20 base + 5 grant
  })

  it('returns null limit when qualified >= unlimitedAt', async () => {
    mockDb.jobView.count.mockResolvedValue(0)
    mockDb.referral.count.mockResolvedValue(12)
    mockDb.jobViewGrant.aggregate.mockResolvedValue({ _sum: { amount: null } })

    const q = await getQuota('s1')
    expect(q.limit).toBeNull()
    expect(q.next).toBe(0)
  })

  it('returns null limit when studentQuota.enabled is false', async () => {
    setupSettings({ 'studentQuota.enabled': false })
    mockDb.jobView.count.mockResolvedValue(100)
    mockDb.referral.count.mockResolvedValue(0)
    mockDb.jobViewGrant.aggregate.mockResolvedValue({ _sum: { amount: null } })

    const q = await getQuota('s1')
    expect(q.limit).toBeNull()
  })

  it('next is capped at referrals needed for unlimitedAt', async () => {
    mockDb.jobView.count.mockResolvedValue(0)
    mockDb.referral.count.mockResolvedValue(11) // 1 away from unlimitedAt=12
    mockDb.jobViewGrant.aggregate.mockResolvedValue({ _sum: { amount: null } })

    const q = await getQuota('s1')
    // tierSize=3, 11 % 3 = 2, so tierSize - 2 = 1; unlimitedAt - 11 = 1; min(1,1) = 1
    expect(q.next).toBe(1)
  })
})

describe('getQuota — only counts QUALIFIED referrals by status filter (M2-T13 item 6)', () => {
  it('referral.count called with status QUALIFIED in getQuota', async () => {
    mockDb.jobView.count.mockResolvedValue(0)
    mockDb.referral.count.mockResolvedValue(0)
    mockDb.jobViewGrant.aggregate.mockResolvedValue({ _sum: { amount: null } })

    await getQuota('s1')

    expect(mockDb.referral.count).toHaveBeenCalledWith({
      where: { referrerId: 's1', status: 'QUALIFIED' },
    })
  })
})

describe('openJob — only counts QUALIFIED referrals by status filter (M2-T13 item 6)', () => {
  it('referral.count called with status QUALIFIED inside openJob transaction', async () => {
    mockDb.jobView.count.mockResolvedValue(0)
    mockDb.referral.count.mockResolvedValue(0)
    mockDb.jobViewGrant.aggregate.mockResolvedValue({ _sum: { amount: null } })

    await openJob('s1', 'j1')

    // referral.count should have been called inside the transaction with status: 'QUALIFIED'
    const referralCountCalls = mockDb.referral.count.mock.calls
    expect(referralCountCalls.length).toBeGreaterThanOrEqual(1)
    for (const [args] of referralCountCalls) {
      expect((args as { where: { status: string } }).where.status).toBe('QUALIFIED')
    }
  })
})

describe('openJob', () => {
  it('allows and does not count for applied jobs', async () => {
    mockDb.application.findFirst.mockResolvedValue({ id: 'app1' })
    mockDb.jobView.count.mockResolvedValue(0)
    mockDb.referral.count.mockResolvedValue(0)

    const result = await openJob('s1', 'j1')
    expect(result.allowed).toBe(true)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
    expect(mockDb.jobView.create).not.toHaveBeenCalled()
  })

  it('allows and does not count for invited jobs', async () => {
    mockDb.invitation.findFirst.mockResolvedValue({ id: 'inv1' })
    mockDb.jobView.count.mockResolvedValue(0)
    mockDb.referral.count.mockResolvedValue(0)

    const result = await openJob('s1', 'j1')
    expect(result.allowed).toBe(true)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('allows repeated open of same non-exempt job without re-counting', async () => {
    mockDb.jobView.findUnique.mockResolvedValue({ studentId: 's1' }) // already viewed
    mockDb.jobView.count.mockResolvedValue(5)
    mockDb.referral.count.mockResolvedValue(0)

    const result = await openJob('s1', 'j1')
    expect(result.allowed).toBe(true)
    expect(mockDb.jobView.create).not.toHaveBeenCalled()
  })

  it('denies when quota exhausted', async () => {
    mockDb.jobView.count.mockResolvedValue(20) // used = limit = 20
    mockDb.referral.count.mockResolvedValue(0)

    const result = await openJob('s1', 'j1')
    expect(result.allowed).toBe(false)
    expect(mockDb.jobView.create).not.toHaveBeenCalled()
  })

  it('allows and inserts when quota available', async () => {
    mockDb.jobView.count.mockResolvedValue(5) // used < limit=20
    mockDb.referral.count.mockResolvedValue(0)

    const result = await openJob('s1', 'j1')
    expect(result.allowed).toBe(true)
    expect(mockDb.jobView.create).toHaveBeenCalledWith({
      data: { studentId: 's1', jobId: 'j1' },
    })
    expect(result.quota.used).toBe(6) // incremented
  })

  it('acquires advisory lock before counting', async () => {
    mockDb.jobView.count.mockResolvedValue(0)
    mockDb.referral.count.mockResolvedValue(0)

    await openJob('s1', 'j1')
    expect(mockLockXact).toHaveBeenCalledWith(expect.anything(), 1001, 's1')
  })

  it('allows unlimited views when quota disabled', async () => {
    setupSettings({ 'studentQuota.enabled': false })
    mockDb.jobView.count.mockResolvedValue(999)
    mockDb.referral.count.mockResolvedValue(0)

    const result = await openJob('s1', 'j1')
    expect(result.allowed).toBe(true)
    expect(result.quota.limit).toBeNull()
  })

  it('PURCHASE and ADMIN_GRANT grants increase effective limit', async () => {
    mockDb.jobView.count.mockResolvedValue(20) // at base limit
    mockDb.referral.count.mockResolvedValue(0)
    mockDb.jobViewGrant.aggregate.mockResolvedValue({ _sum: { amount: 5 } }) // +5 grant

    const result = await openJob('s1', 'j1')
    expect(result.allowed).toBe(true) // 20 < 25 (base + grant)
  })
})
