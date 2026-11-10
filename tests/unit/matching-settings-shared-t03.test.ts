import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ user: vi.fn(), get: vi.fn(), set: vi.fn(), env: { VOYAGE_API_KEY: 'synthetic-only', AI_MODEL_EMBED: 'synthetic-model' } }))
vi.mock('@/server/db', () => ({ db: { user: { findUnique: io.user } } }))
vi.mock('@/server/services/settings', () => ({ getSetting: io.get, setSetting: io.set }))
vi.mock('@/env', () => ({ env: io.env }))
import { SETTINGS, updateMatchingSettingsAdmin, updateSettingAdmin } from '@/server/services/admin-settings'
import { MATCHING_CONFIGURATION_ID, matchingGateSchema } from '@/schemas/semantic-matching'

const ctx = { userId: 'synthetic-admin' }
const version = 'synthetic-matching-policy'
const disabled = { enabled: false, legalVersion: null, configurationId: MATCHING_CONFIGURATION_ID }
beforeEach(() => {
  io.user.mockReset().mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' })
  io.get.mockReset().mockResolvedValue(version)
  io.set.mockReset().mockResolvedValue(undefined)
  io.env.VOYAGE_API_KEY = 'synthetic-only'
  io.env.AI_MODEL_EMBED = 'synthetic-model'
})

describe('independent matching gate writer', () => {
  it('rotates a server UUID on enable and every disable', async () => {
    await updateMatchingSettingsAdmin(ctx, { ...disabled, enabled: true, legalVersion: version })
    await updateMatchingSettingsAdmin(ctx, disabled)
    await updateMatchingSettingsAdmin(ctx, disabled)
    expect(io.get).toHaveBeenCalledExactlyOnceWith('legal.currentVersion', '2026-11-draft', { fresh: true })
    const epochs = io.set.mock.calls.map(([key, value, actor]) => {
      expect(key).toBe('ai.matching')
      expect(actor).toBe(ctx.userId)
      return matchingGateSchema.parse(value).epoch
    })
    expect(epochs).toHaveLength(3)
    expect(new Set(epochs).size).toBe(3)
  })
  it.each([null, 7, 'old', ''])('rejects enabling against legal value %s', async current => {
    io.get.mockResolvedValue(current)
    await expect(updateMatchingSettingsAdmin(ctx, { ...disabled, enabled: true, legalVersion: version })).rejects.toMatchObject({ code: 'VERSION_MISMATCH' })
    expect(io.set).not.toHaveBeenCalled()
  })
  it.each(['VOYAGE_API_KEY', 'AI_MODEL_EMBED'] as const)('requires explicit %s only when enabling', async key => {
    io.env[key] = ''
    await expect(updateMatchingSettingsAdmin(ctx, { ...disabled, enabled: true, legalVersion: version })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(io.set).not.toHaveBeenCalled()
    await updateMatchingSettingsAdmin(ctx, disabled)
    expect(io.set).toHaveBeenCalledOnce()
  })
  it.each([{ epoch: '00000000-0000-4000-8000-000000000000' }, { key: 'ai.resumeParse' }, { model: 'other' }, { configurationId: 'unsupported' }])('rejects caller-selected controls %j', async extra => {
    await expect(updateMatchingSettingsAdmin(ctx, { ...disabled, ...extra })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(io.set).not.toHaveBeenCalled()
  })
  it.each([null, { role: 'EMPLOYER', status: 'ACTIVE' }, { role: 'ADMIN', status: 'SUSPENDED' }])('rechecks active administrator %j', async user => {
    io.user.mockResolvedValue(user)
    await expect(updateMatchingSettingsAdmin(ctx, disabled)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(io.set).not.toHaveBeenCalled()
  })
  it('excludes the gate from generic settings and rejects a generic write', async () => {
    expect(SETTINGS.some(item => item.key === 'ai.matching')).toBe(false)
    await expect(updateSettingAdmin(ctx, 'ai.matching', disabled)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(io.set).not.toHaveBeenCalled()
  })
  it.each([['ai.matching.reconcileBatchSize', 25, 50], ['ai.matching.reconcileEveryMinutes', 5, 30]] as const)('bounds scheduler setting %s', async (key, value, maximum) => {
    expect(SETTINGS.find(item => item.key === key)?.defaultValue).toBe(value)
    for (const bad of [0, -1, 1.5, maximum + 1, '5', true]) {
      await expect(updateSettingAdmin(ctx, key, bad)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
    expect(io.set).not.toHaveBeenCalled()
  })
})
