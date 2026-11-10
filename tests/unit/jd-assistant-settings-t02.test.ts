import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ user: vi.fn(), get: vi.fn(), set: vi.fn() }))
vi.mock('@/server/db', () => ({ db: { user: { findUnique: io.user } } }))
vi.mock('@/server/services/settings', () => ({ getSetting: io.get, setSetting: io.set }))

import { SETTINGS, updateJdAssistantSettingsAdmin, updateSettingAdmin } from '@/server/services/admin-settings'
import { resumeParseGateSchema } from '@/server/schemas/resume-parsing'

const version = 'synthetic-jd-policy'
const ctx = { userId: 'synthetic-admin' }
beforeEach(() => {
  io.user.mockReset().mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE' })
  io.get.mockReset().mockResolvedValue(version)
  io.set.mockReset().mockResolvedValue(undefined)
})

describe('independent JD settings writer', () => {
  it('writes only the JD gate with a fresh server UUID on every update, including repeated disables', async () => {
    await updateJdAssistantSettingsAdmin(ctx, { enabled: true, legalVersion: version })
    await updateJdAssistantSettingsAdmin(ctx, { enabled: false, legalVersion: null })
    await updateJdAssistantSettingsAdmin(ctx, { enabled: false, legalVersion: null })
    expect(io.get).toHaveBeenCalledExactlyOnceWith('legal.currentVersion', '2026-11-draft', { fresh: true })
    expect(io.set).toHaveBeenCalledTimes(3)
    const epochs = io.set.mock.calls.map(([key, value, actor]) => {
      expect(key).toBe('ai.jdAssistant')
      expect(actor).toBe(ctx.userId)
      return resumeParseGateSchema.parse(value).epoch
    })
    expect(new Set(epochs).size).toBe(3)
  })

  it.each([null, 'outdated', 7])('fails closed when the current legal version is %s', async current => {
    io.get.mockResolvedValue(current)
    await expect(updateJdAssistantSettingsAdmin(ctx, { enabled: true, legalVersion: version })).rejects.toMatchObject({ code: 'VERSION_MISMATCH' })
    expect(io.set).not.toHaveBeenCalled()
  })

  it.each([
    { enabled: 'true', legalVersion: version },
    { enabled: true, legalVersion: version, epoch: '00000000-0000-4000-8000-000000000000' },
    { enabled: false, legalVersion: null, key: 'ai.resumeParse' },
  ])('rejects untrusted configuration %j', async value => {
    await expect(updateJdAssistantSettingsAdmin(ctx, value)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(io.set).not.toHaveBeenCalled()
  })

  it.each([{ role: 'EMPLOYER', status: 'ACTIVE' }, { role: 'ADMIN', status: 'SUSPENDED' }, null])('rechecks active admin identity %j', async user => {
    io.user.mockResolvedValue(user)
    await expect(updateJdAssistantSettingsAdmin(ctx, { enabled: false, legalVersion: null })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(io.set).not.toHaveBeenCalled()
  })

  it('does not permit the generic settings route to bypass the gate writer', async () => {
    await expect(updateSettingAdmin(ctx, 'ai.jdAssistant', { enabled: true, legalVersion: version })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(io.set).not.toHaveBeenCalled()
  })

  it.each([
    ['limits.aiJdPerUserPerHour', 10],
    ['limits.aiJdPerCompanyPerHour', 30],
  ])('registers %s with strict 1..1000 integers and default %i', async (key, defaultValue) => {
    expect(SETTINGS.find(item => item.key === key)?.defaultValue).toBe(defaultValue)
    for (const value of [0, -1, 1.5, 1001, '10', true, null]) {
      await expect(updateSettingAdmin(ctx, String(key), value)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
    expect(io.set).not.toHaveBeenCalled()
    await updateSettingAdmin(ctx, String(key), 1)
    await updateSettingAdmin(ctx, String(key), 1000)
    expect(io.set).toHaveBeenCalledTimes(2)
  })
})
