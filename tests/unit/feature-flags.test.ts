import { vi, describe, it, expect, beforeEach } from 'vitest'
import { FeatureDisabledError } from '@/server/errors'

vi.mock('@/server/services/settings', () => ({
  getSetting: vi.fn(),
}))

const { getSetting } = await import('@/server/services/settings')
const { assertUnlockEnabled, assertTalentSearchEnabled, assertUploadsEnabled } =
  await import('@/server/services/feature-flags')

const mockGetSetting = vi.mocked(getSetting)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertUnlockEnabled', () => {
  it('resolves when unlock.enabled is true', async () => {
    mockGetSetting.mockResolvedValueOnce(true)
    await expect(assertUnlockEnabled()).resolves.toBeUndefined()
  })

  it('throws FeatureDisabledError when unlock.enabled is false', async () => {
    mockGetSetting.mockResolvedValueOnce(false)
    await expect(assertUnlockEnabled()).rejects.toThrow(FeatureDisabledError)
  })

  it('throws when getSetting returns string "false"', async () => {
    mockGetSetting.mockResolvedValueOnce('false')
    await expect(assertUnlockEnabled()).rejects.toThrow(FeatureDisabledError)
  })

  it('throws when getSetting returns 0', async () => {
    mockGetSetting.mockResolvedValueOnce(0)
    await expect(assertUnlockEnabled()).rejects.toThrow(FeatureDisabledError)
  })

  it('throws when getSetting returns null', async () => {
    mockGetSetting.mockResolvedValueOnce(null)
    await expect(assertUnlockEnabled()).rejects.toThrow(FeatureDisabledError)
  })

  it('throws when getSetting returns string "true"', async () => {
    mockGetSetting.mockResolvedValueOnce('true')
    await expect(assertUnlockEnabled()).rejects.toThrow(FeatureDisabledError)
  })
})

describe('assertTalentSearchEnabled', () => {
  it('resolves when talentPool.searchEnabled is true', async () => {
    mockGetSetting.mockResolvedValueOnce(true)
    await expect(assertTalentSearchEnabled()).resolves.toBeUndefined()
  })

  it('throws FeatureDisabledError when talentPool.searchEnabled is false', async () => {
    mockGetSetting.mockResolvedValueOnce(false)
    await expect(assertTalentSearchEnabled()).rejects.toThrow(FeatureDisabledError)
  })
})

describe('assertUploadsEnabled', () => {
  it('resolves when uploads.enabled is true', async () => {
    mockGetSetting.mockResolvedValueOnce(true)
    await expect(assertUploadsEnabled()).resolves.toBeUndefined()
  })

  it('throws FeatureDisabledError when uploads.enabled is false', async () => {
    mockGetSetting.mockResolvedValueOnce(false)
    await expect(assertUploadsEnabled()).rejects.toThrow(FeatureDisabledError)
  })

  it('defaults to enabled when setting is absent (getSetting returns default)', async () => {
    // When key is absent, getSetting returns the default (true); feature stays enabled
    mockGetSetting.mockResolvedValueOnce(true)
    await expect(assertUploadsEnabled()).resolves.toBeUndefined()
  })
})
