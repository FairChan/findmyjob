import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ user: vi.fn(), get: vi.fn(), set: vi.fn(), published: vi.fn(), configured: vi.fn() }))
vi.mock('@/server/db', () => ({ db: { user: { findUnique: io.user } } }))
vi.mock('@/server/services/settings', () => ({ getSetting: io.get, setSetting: io.set }))
vi.mock('@/server/lib/marketing-disclosure', () => ({ isMarketingDisclosurePublished: io.published }))
vi.mock('@/server/lib/marketing-unsubscribe', () => ({ marketingUnsubscribeConfigured: io.configured }))
import { SETTINGS, updateMarketingSettingsAdmin, updateSettingAdmin } from '@/server/services/admin-settings'
import { marketingGateInputSchema } from '@/schemas/marketing-settings'

beforeEach(() => {
  vi.clearAllMocks()
  io.user.mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' })
  io.get.mockResolvedValue('synthetic-policy')
  io.set.mockResolvedValue(undefined)
  io.published.mockResolvedValue(true)
  io.configured.mockReturnValue(true)
})
describe('marketing independent default-off controlled writer', () => {
  it('rejects caller epoch and unrelated controls', () => {
    for (const extra of [{ epoch: 'old' }, { userId: 'other' }, { published: true }]) {
      expect(marketingGateInputSchema.safeParse({ enabled: false, legalVersion: '', ...extra }).success).toBe(false)
    }
  })
  it('rotates every write including repeated disables without publication or secret', async () => {
    io.published.mockResolvedValue(false); io.configured.mockReturnValue(false)
    await updateMarketingSettingsAdmin({ userId: 'admin' }, { enabled: false, legalVersion: '' })
    await updateMarketingSettingsAdmin({ userId: 'admin' }, { enabled: false, legalVersion: '' })
    const epochs = io.set.mock.calls.map(([key, value]) => {
      expect(key).toBe('marketing.weekly')
      expect(value.enabled).toBe(false)
      expect(value.epoch).toMatch(/^[0-9a-f-]{36}$/)
      return value.epoch
    })
    expect(new Set(epochs).size).toBe(2)
    expect(io.get).not.toHaveBeenCalled()
  })
  it.each(['old', null, 7])('rejects stale/corrupt current legal version %s', async version => {
    io.get.mockResolvedValue(version)
    await expect(updateMarketingSettingsAdmin({ userId: 'admin' }, { enabled: true, legalVersion: 'synthetic-policy' })).rejects.toMatchObject({ code: 'VERSION_MISMATCH' })
    expect(io.set).not.toHaveBeenCalled()
  })
  it.each(['publication', 'secret'])('rejects enable without %s', async requirement => {
    if (requirement === 'publication') io.published.mockResolvedValue(false)
    else io.configured.mockReturnValue(false)
    await expect(updateMarketingSettingsAdmin({ userId: 'admin' }, { enabled: true, legalVersion: 'synthetic-policy' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(io.set).not.toHaveBeenCalled()
  })
  it('enables only with fresh current version and server epoch', async () => {
    await updateMarketingSettingsAdmin({ userId: 'admin' }, { enabled: true, legalVersion: 'synthetic-policy' })
    expect(io.get).toHaveBeenCalledWith('legal.currentVersion', null, { fresh: true })
    expect(io.published).toHaveBeenCalledWith('synthetic-policy')
    expect(io.set).toHaveBeenCalledWith('marketing.weekly', { enabled: true, legalVersion: 'synthetic-policy', epoch: expect.any(String) }, 'admin')
  })
  it.each([null, { role: 'EMPLOYER', status: 'ACTIVE' }, { role: 'ADMIN', status: 'SUSPENDED' }])('rechecks administrator %j', async user => {
    io.user.mockResolvedValue(user)
    await expect(updateMarketingSettingsAdmin({ userId: 'admin' }, { enabled: false, legalVersion: '' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(io.set).not.toHaveBeenCalled()
  })
  it('excludes both independent gates from generic settings', async () => {
    expect(SETTINGS.some(item => ['marketing.weekly', 'ai.matching'].includes(item.key))).toBe(false)
    await expect(updateSettingAdmin({ userId: 'admin' }, 'marketing.weekly', { enabled: true })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(io.set).not.toHaveBeenCalled()
  })
})
