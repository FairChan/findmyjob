import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/db', () => ({
  db: {
    consent: {
      createMany: vi.fn(),
    },
  },
}))

vi.mock('@/server/services/settings', () => ({
  getSetting: vi.fn(),
}))

const { recordConsents } = await import('@/server/services/consent')
const { db } = await import('@/server/db')
const { getSetting } = await import('@/server/services/settings')

const mockCreateMany = vi.mocked(db.consent.createMany)
const mockGetSetting = vi.mocked(getSetting)

beforeEach(() => {
  vi.clearAllMocks()
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

    expect(mockGetSetting).toHaveBeenCalledWith('legal.currentVersion', '1.0')
    expect(mockCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: 'user-1', type: 'TERMS', granted: true, version: '2.0' }),
      ],
    })
  })

  it('stores ip and userAgent in every record', async () => {
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
