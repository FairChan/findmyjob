import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mail = vi.hoisted(() => vi.fn())
vi.mock('@/server/db', async () => ({ db: (await import('../helpers/weekly-final-races-t04')).actorDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/lib/email', async original => ({
  ...await original<typeof import('@/lib/email')>(),
  createEmailProvider: () => ({ sendEmail: mail }),
}))
vi.mock('@/server/lib/marketing-disclosure', () => ({ isMarketingDisclosurePublished: vi.fn().mockResolvedValue(true) }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn(() => { throw new Error('No external AI') }) }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn().mockResolvedValue(true),
  writeSemanticVector: vi.fn(), deleteSemanticVector: vi.fn(),
  findTalentNeighbors: vi.fn().mockResolvedValue([]), findJobNeighbors: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env,
    VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model',
    MARKETING_UNSUBSCRIBE_SECRET: 't'.repeat(48),
  } }
})

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin } from '../factories'
import { raceActors } from '../helpers/weekly-final-races-t04'
import { seedT04Gate, t04EmployerRecipient, t04Talent, t04Queued } from '../helpers/weekly-digest-t04'
import { readyT03Student, t03Student } from '../helpers/semantic-matching-t03'
import { updateSettingAdmin } from '@/server/services/admin-settings'
import { clearSettingsCache } from '@/server/services/settings'
import { sendWeeklyDigestEmail } from '@/server/services/weekly-digest-send'

const poolSettings = [
  { key: 'talentPool.searchEnabled', before: true, after: false },
  { key: 'talentPool.minCompleteness', before: 60, after: 90 },
] as const

setupTestDb()
beforeEach(async () => {
  vi.clearAllMocks()
  clearSettingsCache()
  mail.mockResolvedValue(undefined)
  await seedT04Gate()
})

async function fixture() {
  const admin = await createAdmin(testDb)
  for (const setting of poolSettings) await updateSettingAdmin(admin, setting.key, setting.before)
  const employer = await t04EmployerRecipient()
  const first = await t04Talent() // 70: admitted at 60, excluded at 90.
  const second = await t03Student()
  await testDb.studentProfile.update({ where: { id: second.profileId }, data: { completeness: 100 } })
  // Build READY metadata after the fixture edit; never bypass real index eligibility.
  await readyT03Student(second)
  const row = await t04Queued(employer.userId)
  const leaseToken = randomUUID()
  const ids = [first.item.id, second.profileId]
  await testDb.weeklyDigestDelivery.update({ where: { id: row.id }, data: {
    state: 'PREPARING', leaseToken, leaseExpiresAt: new Date(Date.now() + 120_000), candidateIds: ids,
  } })
  return { admin, employer, ids, input: { deliveryId: row.id, leaseToken } }
}

async function visiblePreparing(deliveryId: string) {
  const row = await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
  expect(row.state).toBe('PREPARING')
  expect(mail).not.toHaveBeenCalled()
}

async function reportEarlyCommit(setting: typeof poolSettings[number], initial: string, deliveryId: string): Promise<never> {
  const saved = await testDb.systemSetting.findUniqueOrThrow({ where: { key: setting.key } })
  expect(saved.value).toBe(setting.after)
  await visiblePreparing(deliveryId)
  throw new Error(`Observed ${setting.key}=${String(saved.value)} committed from ${initial} while delivery remained PREPARING and mail calls=0`)
}

describe('T04 employer final transaction pool settings', () => {
  describe.each(['existing row', 'missing row/default'] as const)('sender first with %s', initial => {
    it.each(poolSettings)('blocks the real $key admin upsert until SENDING commits', async setting => {
      const { admin, employer, ids, input } = await fixture()
      if (initial === 'missing row/default') {
        await testDb.systemSetting.delete({ where: { key: setting.key } })
        clearSettingsCache()
      }
      const before = await testDb.systemSetting.findUnique({ where: { key: setting.key } })
      expect(before?.value ?? null).toBe(initial === 'missing row/default' ? null : setting.before)
      // Context has read searchEnabled and reload has read minCompleteness before
      // either barrier. Minimum is also re-read inside visibility for each DTO:
      // stop at candidate two so candidate one's 70-point DTO is already admitted.
      const barrierId = setting.key === 'talentPool.minCompleteness' ? ids[1] : ids[0]
      const race = raceActors('studentProfile', barrierId)
      try {
        const send = race.sender(() => sendWeeklyDigestEmail(input))
        await race.entered()
        await visiblePreparing(input.deliveryId)
        let committed = false
        const write = race.writer(async () => {
          await updateSettingAdmin(admin, setting.key, setting.after)
          committed = true
        })
        try {
          await race.expectWriterBlocked(write)
        } catch (error) {
          if (!committed) throw error
          // A RED result must witness a committed real upsert while sender is
          // still paused before SENDING; a timeout alone is not race evidence.
          await reportEarlyCommit(setting, initial, input.deliveryId)
        }
        expect(committed).toBe(false)
        await visiblePreparing(input.deliveryId)
        const saved = await testDb.systemSetting.findUnique({ where: { key: setting.key } })
        expect(saved?.value ?? null).toBe(initial === 'missing row/default' ? null : setting.before)

        race.release()
        expect(await send).toEqual({ status: 'accepted' })
        await write
        expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: input.deliveryId } })).state).toBe('SENDING')
        expect((await testDb.systemSetting.findUniqueOrThrow({ where: { key: setting.key } })).value).toBe(setting.after)
        expect(mail).toHaveBeenCalledOnce()
        const message = JSON.stringify(mail.mock.calls[0][0])
        expect(message).toContain(employer.email)
        for (const id of ids) expect(message).toContain(id)
      } finally {
        await race.close()
      }
    })
  })

  it('suppresses when the real searchEnabled=false writer commits first', async () => {
    const { admin, input } = await fixture()
    await updateSettingAdmin(admin, 'talentPool.searchEnabled', false)
    expect((await testDb.systemSetting.findUniqueOrThrow({ where: { key: 'talentPool.searchEnabled' } })).value).toBe(false)
    expect(await sendWeeklyDigestEmail(input)).toEqual({ status: 'suppressed' })
    await visiblePreparing(input.deliveryId)
  })

  it('filters the 70-point DTO when the real minCompleteness=90 writer commits first', async () => {
    const { admin, employer, ids, input } = await fixture()
    await updateSettingAdmin(admin, 'talentPool.minCompleteness', 90)
    expect((await testDb.systemSetting.findUniqueOrThrow({ where: { key: 'talentPool.minCompleteness' } })).value).toBe(90)
    expect(await sendWeeklyDigestEmail(input)).toEqual({ status: 'accepted' })
    expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: input.deliveryId } })).state).toBe('SENDING')
    expect(mail).toHaveBeenCalledOnce()
    const message = JSON.stringify(mail.mock.calls[0][0])
    expect(message).toContain(employer.email)
    expect(message).not.toContain(ids[0])
    expect(message).toContain(ids[1])
  })
})
