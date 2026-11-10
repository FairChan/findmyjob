import { beforeEach, describe, expect, it, vi } from 'vitest'
// Isolate only the human publication prerequisite, preserving actual state/provider seams.
vi.mock('@/server/lib/marketing-disclosure', () => ({ isMarketingDisclosurePublished: vi.fn().mockResolvedValue(true) }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic', AI_MODEL_EMBED: 'synthetic-embedding-model', MARKETING_UNSUBSCRIBE_SECRET: 't'.repeat(48) } }
})
import { setupTestDb, testDb } from '../setup/db'
import { seedT04Gate, t04StudentRecipient } from '../helpers/weekly-digest-t04'
import { T03_VERSION } from '../helpers/semantic-matching-t03'
import { getMarketingUiState, setMarketingConsent } from '@/server/services/marketing-consent'
import { clearSettingsCache } from '@/server/services/settings'
setupTestDb()
beforeEach(async () => { vi.clearAllMocks(); clearSettingsCache(); await seedT04Gate() })
describe('T04 UI state and withdrawal compatibility', () => {
  it('returns only the UI DTO and withdraws without a submitted version after policy changes', async () => {
    const student = await t04StudentRecipient()
    expect(await getMarketingUiState(student)).toEqual({ available: true, consentGranted: true, legalVersion: T03_VERSION })
    await testDb.systemSetting.update({ where: { key: 'marketing.weekly' }, data: { value: { enabled: false } } })
    await testDb.systemSetting.update({ where: { key: 'legal.currentVersion' }, data: { value: 'changed-policy' } })
    await expect(setMarketingConsent(student, { granted: false })).resolves.toBeUndefined()
    expect(await getMarketingUiState(student)).toEqual({ available: false, consentGranted: false, legalVersion: 'changed-policy' })
  })
  it('does not let an older-version opt-in overwrite a later withdrawal', async () => {
    const student = await t04StudentRecipient()
    await setMarketingConsent(student, { granted: false, submittedVersion: null })
    await expect(setMarketingConsent(student, { granted: true, submittedVersion: 'old-policy' })).rejects.toMatchObject({ code: 'VERSION_MISMATCH' })
    expect((await getMarketingUiState(student)).consentGranted).toBe(false)
  })
})
