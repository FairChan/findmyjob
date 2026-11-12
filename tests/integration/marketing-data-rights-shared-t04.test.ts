import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/server/lib/marketing-disclosure', () => ({ isMarketingDisclosurePublished: vi.fn().mockResolvedValue(true) }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-queue') } }))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn() }))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic', AI_MODEL_EMBED: 'synthetic-embedding-model', MARKETING_UNSUBSCRIBE_SECRET: 't'.repeat(48) } }
})
import { setupTestDb, testDb } from '../setup/db'
import { seedT04Gate, t04StudentRecipient, t04Queued } from '../helpers/weekly-digest-t04'
import { readDataExportSnapshot } from '@/server/services/data-export-snapshot'
import { requestDeletion } from '@/server/services/data-rights'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(async () => { clearSettingsCache(); await seedT04Gate() })
describe('owner marketing metadata and deletion', () => {
  it('exports only kind/weekKey/state/sentAt and keeps preference in privacy history', async () => {
    const user = await t04StudentRecipient(), row = await t04Queued(user.userId)
    const snapshot = await testDb.$transaction(tx => readDataExportSnapshot(tx, user.userId))
    const deliveries = snapshot!.files['marketing-deliveries.json'] as Array<Record<string, unknown>>
    expect(deliveries).toHaveLength(1)
    expect(Object.keys(deliveries[0]).sort()).toEqual(['kind', 'sentAt', 'state', 'weekKey'])
    expect(deliveries[0]).toMatchObject({ kind: 'STUDENT_JOBS', state: row.state, sentAt: null })
    const privacy = snapshot!.files['privacy.json'] as { consents: Array<{ type: string; granted: boolean }> }
    expect(privacy.consents).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'MARKETING', granted: true })]))
  })
  it.each(['QUEUED', 'PREPARING', 'RETRYABLE'] as const)('deletion suppresses %s and clears transient data atomically', async state => {
    const user = await t04StudentRecipient(), row = await t04Queued(user.userId)
    await testDb.weeklyDigestDelivery.update({ where: { id: row.id }, data: { state, leaseToken: 'synthetic', leaseExpiresAt: new Date(Date.now() + 60_000), candidateIds: ['synthetic-candidate'] } })
    await requestDeletion(user)
    expect(await testDb.weeklyDigestDelivery.findUnique({ where: { id: row.id } })).toMatchObject({ state: 'SKIPPED', leaseToken: null, leaseExpiresAt: null, nextAttemptAt: null, candidateIds: [] })
    expect(await testDb.user.findUnique({ where: { id: user.userId } })).toMatchObject({ status: 'DELETED' })
  })
  it.each(['SENDING', 'SENT', 'UNKNOWN'] as const)('deletion never revives or retries %s', async state => {
    const user = await t04StudentRecipient(), row = await t04Queued(user.userId)
    await testDb.weeklyDigestDelivery.update({ where: { id: row.id }, data: { state } })
    await requestDeletion(user)
    expect(await testDb.weeklyDigestDelivery.findUnique({ where: { id: row.id } })).toMatchObject({ state })
  })
})
