import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/lib/marketing-disclosure', () => ({ isMarketingDisclosurePublished: vi.fn().mockResolvedValue(true) }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: smtp.sendMail, close: smtp.close }) }))
vi.mock('@/server/lib/email-cap', () => ({ checkEmailCap: vi.fn().mockResolvedValue(true) }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn(() => { throw new Error('No real AI in weekly tests') }) }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn().mockResolvedValue(true), writeSemanticVector: vi.fn(), deleteSemanticVector: vi.fn(),
  findTalentNeighbors: vi.fn().mockResolvedValue([]), findJobNeighbors: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/server/services/semantic-matching', async original => ({
  ...await original<typeof import('@/server/services/semantic-matching')>(), recommendJobs: vi.fn(), recommendTalents: vi.fn(),
}))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://synthetic.invalid',
    VOYAGE_API_KEY: 'synthetic', AI_MODEL_EMBED: 'synthetic-embedding-model',
    MARKETING_UNSUBSCRIBE_SECRET: 't'.repeat(48) } }
})
import { setupTestDb, testDb } from '../setup/db'
import { seedT04Gate, t04StudentRecipient, t04Job, t04Queued } from '../helpers/weekly-digest-t04'
import { recommendJobs } from '@/server/services/semantic-matching'
import { clearSettingsCache } from '@/server/services/settings'
import { runWeeklyDigest, recoverWeeklyDigests } from '@/server/jobs/weekly-digest'

setupTestDb()
beforeEach(async () => { vi.clearAllMocks(); clearSettingsCache(); await seedT04Gate() })
afterEach(() => vi.useRealTimers())
it('real weekly sender owns a timed-out SMTP promise until settlement, then preserves UNKNOWN without retry', async () => {
  const student = await t04StudentRecipient(), job = await t04Job('DRAIN_SYNTHETIC'), row = await t04Queued(student.userId)
  vi.mocked(recommendJobs).mockResolvedValue({ availability: 'ready', items: [job.item] })
  let release!: (value: unknown) => void, entered!: () => void
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  smtp.sendMail.mockImplementationOnce(() => { entered(); return held })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let completed = false
  const running = runWeeklyDigest({ deliveryId: row.id }).then(() => { completed = true })
  await started
  await vi.advanceTimersByTimeAsync(20_001)
  expect(completed).toBe(false)
  expect(smtp.close).toHaveBeenCalledOnce()
  expect(await testDb.weeklyDigestDelivery.findUnique({ where: { id: row.id } })).toMatchObject({ state: 'SENDING' })
  release({ accepted: [student.email], rejected: [] })
  await running
  vi.useRealTimers()
  expect(await testDb.weeklyDigestDelivery.findUnique({ where: { id: row.id } })).toMatchObject({ state: 'UNKNOWN', failureCode: 'OUTCOME_UNKNOWN' })
  await recoverWeeklyDigests()
  await runWeeklyDigest({ deliveryId: row.id })
  expect(smtp.sendMail).toHaveBeenCalledOnce()
})
