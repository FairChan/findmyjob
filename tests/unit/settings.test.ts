import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock the db module so we don't need a real database connection for unit tests
vi.mock('@/server/db', () => ({
  db: {
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}))

// Import after mocking
const { getSetting } = await import('@/server/services/settings')
const { db } = await import('@/server/db')

const mockFindUnique = vi.mocked(db.systemSetting.findUnique)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getSetting', () => {
  it('returns the default value when the key does not exist in the database', async () => {
    mockFindUnique.mockResolvedValueOnce(null)

    // Use unique key to avoid cache hits from other tests
    const val = await getSetting('test.nonexistent.' + Date.now(), 'my-default')
    expect(val).toBe('my-default')
  })

  it('returns a numeric default value', async () => {
    mockFindUnique.mockResolvedValueOnce(null)

    const val = await getSetting('test.numeric.' + Date.now(), 42)
    expect(val).toBe(42)
  })

  it('returns the stored value when the key exists in the database', async () => {
    const key = 'test.existing.' + Date.now()
    mockFindUnique.mockResolvedValueOnce({
      key,
      value: 'stored-value',
      updatedById: null,
      updatedAt: new Date(),
    })

    const val = await getSetting(key, 'fallback')
    expect(val).toBe('stored-value')
  })

  it('caches the result and does not query the database again within TTL', async () => {
    const key = 'test.cached.' + Date.now()
    mockFindUnique.mockResolvedValueOnce(null)

    await getSetting(key, 'cached-default')
    await getSetting(key, 'cached-default')

    // DB should only be called once; second call uses cache
    expect(mockFindUnique).toHaveBeenCalledTimes(1)
  })
})
