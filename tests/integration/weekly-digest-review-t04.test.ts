import { Prisma } from '@prisma/client'
// Isolate only the human publication prerequisite, preserving actual state/provider seams.
vi.mock('@/server/lib/marketing-disclosure', () => ({ isMarketingDisclosurePublished: vi.fn().mockResolvedValue(true) }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
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
import { seedT04Gate, t04StudentRecipient, t04EmployerRecipient, t04Job, t04Talent, t04Queued } from '../helpers/weekly-digest-t04'
import { recommendJobs, recommendTalents } from '@/server/services/semantic-matching'
import { clearSettingsCache } from '@/server/services/settings'
import { runWeeklyDigest, recoverWeeklyDigests } from '@/server/jobs/weekly-digest'
import { checkEmailCap } from '@/server/lib/email-cap'

setupTestDb()
beforeEach(async () => {
  vi.clearAllMocks(); clearSettingsCache()
  smtp.sendMail.mockReset().mockImplementation(async ({ to }: { to: string }) => ({ accepted: [to], rejected: [] }))
  vi.mocked(checkEmailCap).mockReset().mockResolvedValue(true)
  vi.mocked(recommendJobs).mockReset().mockResolvedValue({ availability: 'ready', items: [] })
  vi.mocked(recommendTalents).mockReset().mockResolvedValue({ availability: 'ready', items: [] })
  await seedT04Gate()
})
describe('T04 review regressions with real state transitions and adapter', () => {
  it('retries one proven temporary RCPT rejection on the same row and accepts the next attempt', async () => {
    const student = await t04StudentRecipient(), job = await t04Job('SMTP_RETRY'), queued = await t04Queued(student.userId)
    vi.mocked(recommendJobs).mockResolvedValue({ availability: 'ready', items: [job.item] })
    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error('PRIVATE_RECIPIENT_RESPONSE'), {
      code: 'EENVELOPE', command: 'RCPT TO', responseCode: 450, rejected: [student.email],
    }))
    await runWeeklyDigest({ deliveryId: queued.id })
    expect(await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: queued.id } }))
      .toMatchObject({ state: 'RETRYABLE', sentAt: null, attempts: 1, failureCode: 'PROVIDER_NOT_ACCEPTED' })
    await testDb.weeklyDigestDelivery.update({ where: { id: queued.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })
    await recoverWeeklyDigests()
    await runWeeklyDigest({ deliveryId: queued.id })
    expect(smtp.sendMail).toHaveBeenCalledTimes(2)
    expect(await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: queued.id } }))
      .toMatchObject({ state: 'SENT', attempts: 2, sentAt: expect.any(Date) })
    expect(await testDb.weeklyDigestDelivery.count({ where: { userId: student.userId } })).toBe(1)
  })
  it.each([null, -1, 101, 1.5, '60', 'not-a-number'])('does not email talent when the final completeness setting is invalid: %s', async value => {
    const employer = await t04EmployerRecipient(), talent = await t04Talent(), queued = await t04Queued(employer.userId)
    vi.mocked(recommendTalents).mockResolvedValue({ availability: 'ready', items: [talent.item] })
    vi.mocked(checkEmailCap).mockImplementationOnce(async () => {
      // Simulate malformed persisted/legacy configuration, not an admin UI bypass.
      await testDb.systemSetting.upsert({ where: { key: 'talentPool.minCompleteness' },
        create: { key: 'talentPool.minCompleteness', value: value === null ? Prisma.JsonNull : value },
        update: { value: value === null ? Prisma.JsonNull : value } })
      return true
    })
    await runWeeklyDigest({ deliveryId: queued.id })
    expect(smtp.sendMail).not.toHaveBeenCalled()
    expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: queued.id } })).state).toBe('SKIPPED')
  })
  it.each([0, 60])('preserves normal talent dispatch under valid completeness threshold %s', async value => {
    const employer = await t04EmployerRecipient(), talent = await t04Talent(), queued = await t04Queued(employer.userId)
    vi.mocked(recommendTalents).mockResolvedValue({ availability: 'ready', items: [talent.item] })
    vi.mocked(checkEmailCap).mockImplementationOnce(async () => {
      await testDb.systemSetting.upsert({ where: { key: 'talentPool.minCompleteness' }, create: { key: 'talentPool.minCompleteness', value }, update: { value } })
      return true
    })
    await runWeeklyDigest({ deliveryId: queued.id })
    expect(smtp.sendMail).toHaveBeenCalledOnce()
    expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: queued.id } })).state).toBe('SENT')
  })
})
