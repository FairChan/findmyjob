/** Candidate tests; requires the controlled admin gate fragment. Not run. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createStudent } from '../factories'
import { updateResumeParseSettingsAdmin, updateSettingAdmin } from '@/server/services/admin-settings'
import { clearSettingsCache, getSetting } from '@/server/services/settings'
setupTestDb()
beforeEach(() => clearSettingsCache())

describe('T01 controlled feature configuration', () => {
  it('stays absent by default and never creates a usable implicit epoch', async () => {
    expect(await getSetting('ai.resumeParse', null, { fresh: true })).toBeNull()
    expect(await testDb.systemSetting.count({ where: { key: 'ai.resumeParse' } })).toBe(0)
  })
  it('rotates a server-generated epoch on every update including disable and re-enable', async () => {
    const admin = await createAdmin(testDb), ctx = { userId: admin.userId }
    await updateSettingAdmin(ctx, 'legal.currentVersion', 'synthetic-t01-legal')
    const epochs: string[] = []
    for (const enabled of [true, true, false, true]) {
      await updateResumeParseSettingsAdmin(ctx, { enabled, legalVersion: enabled ? 'synthetic-t01-legal' : null })
      const gate = await getSetting<{ enabled: boolean; legalVersion: string | null; epoch: string }>('ai.resumeParse', null as never, { fresh: true })
      expect(gate.enabled).toBe(enabled)
      expect(gate.epoch).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
      epochs.push(gate.epoch)
    }
    expect(new Set(epochs).size).toBe(4)
    expect(await testDb.auditLog.count({ where: { actorId: admin.userId, action: 'setting.update', targetId: 'ai.resumeParse' } })).toBe(4)
    expect(await getSetting('legal.currentVersion', null, { fresh: true })).toBe('synthetic-t01-legal')
  })
  it.each([null, 'old-version'])('rejects enable with stale or missing legal binding %s', async legalVersion => {
    const admin = await createAdmin(testDb), ctx = { userId: admin.userId }
    await updateSettingAdmin(ctx, 'legal.currentVersion', 'synthetic-current')
    await expect(updateResumeParseSettingsAdmin(ctx, { enabled: true, legalVersion })).rejects.toMatchObject({ code: 'VERSION_MISMATCH' })
    expect(await testDb.systemSetting.count({ where: { key: 'ai.resumeParse' } })).toBe(0)
  })
  it('rejects caller-selected epochs and generic writes atomically', async () => {
    const admin = await createAdmin(testDb), ctx = { userId: admin.userId }
    const forged = { enabled: false, legalVersion: null, epoch: '00000000-0000-4000-8000-000000000000' }
    await expect(updateResumeParseSettingsAdmin(ctx, forged)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(updateSettingAdmin(ctx, 'ai.resumeParse', forged)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await testDb.systemSetting.count({ where: { key: 'ai.resumeParse' } })).toBe(0)
  })
  it.each(['student', 'suspended-admin'] as const)('rejects %s before changing configuration', async role => {
    const actor = role === 'student' ? await createStudent(testDb) : await createAdmin(testDb)
    if (role === 'suspended-admin') await testDb.user.update({ where: { id: actor.userId }, data: { status: 'SUSPENDED' } })
    await expect(updateResumeParseSettingsAdmin({ userId: actor.userId }, { enabled: false, legalVersion: null })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await testDb.systemSetting.count({ where: { key: 'ai.resumeParse' } })).toBe(0)
  })
})
