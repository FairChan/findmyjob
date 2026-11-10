import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockTx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  consent: { findFirst: vi.fn(), createMany: vi.fn() },
}))
vi.mock('@/server/db', () => ({ db: {
  ...mockTx,
  $transaction: vi.fn(async (work: (tx: typeof mockTx) => Promise<void>) => work(mockTx)),
} }))

vi.mock('@/server/services/settings', () => ({
  getSetting: vi.fn(),
}))

const { recordConsents } = await import('@/server/services/consent')
const { db } = await import('@/server/db')
const { getSetting } = await import('@/server/services/settings')

const mockCreateMany = vi.mocked(db.consent.createMany)
const mockGetSetting = vi.mocked(getSetting)
const DB_CLOCK = new Date('2001-02-03T04:05:06.007Z')

beforeEach(() => {
  vi.clearAllMocks()
  mockTx.$executeRaw.mockResolvedValue(1)
  mockTx.$queryRaw.mockResolvedValue([{ now: DB_CLOCK }])
  mockTx.consent.findFirst.mockReset().mockResolvedValue(null)
  mockGetSetting.mockResolvedValue('1.0')
  mockCreateMany.mockResolvedValue({ count: 1 })
})

describe('recordConsents', () => {
  it('creates consent records with version from getSetting', async () => {
    mockGetSetting.mockResolvedValue('2.0')

    await recordConsents(
      'user-1',
      [{ type: 'TERMS', granted: true }],
      { ip: '1.2.3.4', userAgent: 'Mozilla/5.0' },
    )

    expect(db.$transaction).toHaveBeenCalledOnce()
    expect(mockTx.$executeRaw).toHaveBeenCalledExactlyOnceWith(expect.any(Array), 1008, 'user-1')
    expect(mockGetSetting).toHaveBeenCalledWith('legal.currentVersion', '1.0', { tx: mockTx, fresh: true })
    expect(mockTx.consent.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { userId: 'user-1', type: { in: ['TERMS', 'PRIVACY'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true },
    })
    expect(mockCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: 'user-1', type: 'TERMS', granted: true, version: '2.0', createdAt: DB_CLOCK }),
      ],
    })
  })

  it('stores ip and userAgent in every record', async () => {
    const latestConsentAt = new Date(DB_CLOCK.getTime() + 1000)
    mockTx.consent.findFirst.mockResolvedValueOnce({ createdAt: latestConsentAt })
    await recordConsents(
      'user-2',
      [
        { type: 'TERMS', granted: true },
        { type: 'PRIVACY', granted: true },
        { type: 'TALENT_POOL', granted: false },
      ],
      { ip: '10.0.0.1', userAgent: 'TestAgent/1.0' },
    )

    const args = mockCreateMany.mock.calls[0]?.[0]
    if (!args) throw new Error('createMany not called')
    const data = args.data as Record<string, unknown>[]
    expect(data).toHaveLength(3)
    expect(data.map(row => row.createdAt)).toEqual([1, 2, 3].map(offset => new Date(latestConsentAt.getTime() + offset)))
    for (const row of data) {
      expect(row.ip).toBe('10.0.0.1')
      expect(row.userAgent).toBe('TestAgent/1.0')
    }
  })

  it('allows null ip and userAgent', async () => {
    await recordConsents('user-3', [{ type: 'PRIVACY', granted: true }], {})

    const args = mockCreateMany.mock.calls[0]?.[0]
    if (!args) throw new Error('createMany not called')
    const data = args.data as Record<string, unknown>[]
    expect(data[0]?.ip).toBeNull()
    expect(data[0]?.userAgent).toBeNull()
  })

  it('stores TALENT_POOL granted=false correctly', async () => {
    await recordConsents(
      'user-4',
      [{ type: 'TALENT_POOL', granted: false }],
      { ip: null, userAgent: null },
    )

    const args = mockCreateMany.mock.calls[0]?.[0]
    if (!args) throw new Error('createMany not called')
    const data = args.data as Record<string, unknown>[]
    expect(data[0]?.granted).toBe(false)
  })

  it('stores TALENT_POOL granted=true correctly', async () => {
    await recordConsents(
      'user-5',
      [{ type: 'TALENT_POOL', granted: true }],
      { ip: null, userAgent: null },
    )

    const args = mockCreateMany.mock.calls[0]?.[0]
    if (!args) throw new Error('createMany not called')
    const data = args.data as Record<string, unknown>[]
    expect(data[0]?.granted).toBe(true)
  })
})
