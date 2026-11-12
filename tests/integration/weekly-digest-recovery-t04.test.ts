import { inspect } from 'node:util'
// Isolate only the human publication prerequisite, preserving actual state/provider seams.
vi.mock('@/server/lib/marketing-disclosure', () => ({ isMarketingDisclosurePublished: vi.fn().mockResolvedValue(true) }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mail = vi.hoisted(() => vi.fn())
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-queue-job') } }))
vi.mock('@/lib/email', async original => ({ ...await original<typeof import('@/lib/email')>(), createEmailProvider: () => ({ sendEmail: mail }) }))
vi.mock('@/server/lib/email-cap', () => ({ checkEmailCap: vi.fn().mockResolvedValue(true) }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
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
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model', MARKETING_UNSUBSCRIBE_SECRET: 't'.repeat(48) } }
})

import { setupTestDb, testDb } from '../setup/db'
import { seedT04Gate, t04StudentRecipient, t04Job, t04Queued } from '../helpers/weekly-digest-t04'
import { t03Deferred, t03Bounded } from '../helpers/semantic-matching-t03'
import { recommendJobs } from '@/server/services/semantic-matching'
import { scheduleWeeklyDigests, recoverWeeklyDigests, runWeeklyDigest } from '@/server/jobs/weekly-digest'
import { clearSettingsCache } from '@/server/services/settings'
import { EmailDeliveryError } from '@/lib/email'
import { sendBoss } from '@/server/jobs/boss'
import { logger } from '@/server/lib/logger'
import * as Sentry from '@sentry/node'

setupTestDb()
beforeEach(async () => {
  vi.clearAllMocks(); clearSettingsCache(); mail.mockReset().mockResolvedValue(undefined)
  vi.mocked(recommendJobs).mockReset().mockResolvedValue({ availability: 'ready', items: [] })
  await seedT04Gate()
})
async function fixture() {
  const student = await t04StudentRecipient(), job = await t04Job('RECOVERY_JOB'), queued = await t04Queued(student.userId)
  vi.mocked(recommendJobs).mockResolvedValue({ availability: 'ready', items: [job.item] })
  return { student, job, queued }
}
function observe(deliveryId: string) {
  return runWeeklyDigest({ deliveryId }).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
}
async function finish(work: ReturnType<typeof observe>) {
  const result = await t03Bounded(work)
  if (!result.ok) throw result.error
}

describe('M9-T04 same-week delivery and recovery', () => {
  it('deduplicates concurrent schedulers and concurrent workers for one user/week', async () => {
    const f = await fixture()
    await Promise.all([scheduleWeeklyDigests(), scheduleWeeklyDigests()])
    expect(await testDb.weeklyDigestDelivery.count({ where: { userId: f.student.userId } })).toBe(1)
    await Promise.all([runWeeklyDigest({ deliveryId: f.queued.id }), runWeeklyDigest({ deliveryId: f.queued.id })])
    await runWeeklyDigest({ deliveryId: f.queued.id })
    expect(mail).toHaveBeenCalledOnce()
    expect(await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: f.queued.id } })).toMatchObject({ state: 'SENT', sentAt: expect.any(Date) })
  })

  it('keeps a committed row recoverable after queue delivery failed', async () => {
    const student = await t04StudentRecipient()
    vi.mocked(sendBoss.send).mockRejectedValueOnce(new Error('Synthetic queue outage'))
    await scheduleWeeklyDigests()
    const queued = await testDb.weeklyDigestDelivery.findFirstOrThrow({ where: { userId: student.userId } })
    expect(queued.state).toBe('QUEUED')
    vi.mocked(sendBoss.send).mockClear()
    await recoverWeeklyDigests()
    expect(vi.mocked(sendBoss.send).mock.calls).toEqual(expect.arrayContaining([expect.arrayContaining(['weekly-digest', { deliveryId: queued.id }])]))
  })

  it('retries a known pre-acceptance failure using the same row and marks SENT only after acceptance', async () => {
    const f = await fixture()
    mail.mockRejectedValueOnce(new EmailDeliveryError('not-accepted'))
    await runWeeklyDigest({ deliveryId: f.queued.id })
    expect(await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: f.queued.id } })).toMatchObject({ state: 'RETRYABLE', sentAt: null })
    await testDb.weeklyDigestDelivery.update({ where: { id: f.queued.id }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } })
    await recoverWeeklyDigests(); await runWeeklyDigest({ deliveryId: f.queued.id })
    expect(mail).toHaveBeenCalledTimes(2)
    expect(await testDb.weeklyDigestDelivery.count({ where: { userId: f.student.userId } })).toBe(1)
    expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: f.queued.id } })).state).toBe('SENT')
  })

  it('does not automatically resend an unknown transport outcome or persist/log its private error', async () => {
    const f = await fixture(), sentinel = 'PRIVATE_MAIL_FAILURE_AND_RECIPIENT'
    mail.mockRejectedValueOnce(new Error(sentinel))
    await runWeeklyDigest({ deliveryId: f.queued.id })
    await recoverWeeklyDigests(); await runWeeklyDigest({ deliveryId: f.queued.id })
    expect(mail).toHaveBeenCalledOnce()
    expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: f.queued.id } })).state).toBe('UNKNOWN')
    const observed = inspect({
      rows: await testDb.weeklyDigestDelivery.findMany(), audit: await testDb.auditLog.findMany(),
      logs: [logger.error, logger.warn, logger.info, logger.debug].map(fn => vi.mocked(fn).mock.calls),
      sentry: [vi.mocked(Sentry.captureException).mock.calls, vi.mocked(Sentry.captureMessage).mock.calls],
    }, { depth: 20, maxStringLength: Infinity })
    expect(observed).not.toContain(sentinel)
    expect(observed).not.toContain(f.student.email)
  })

  it('moves an expired SENDING intent to UNKNOWN without repeating provider HTTP', async () => {
    const f = await fixture()
    await testDb.weeklyDigestDelivery.update({ where: { id: f.queued.id }, data: { state: 'SENDING', leaseToken: 'synthetic-old-token', leaseExpiresAt: new Date(Date.now() - 1_000) } })
    await recoverWeeklyDigests(); await runWeeklyDigest({ deliveryId: f.queued.id })
    expect(mail).not.toHaveBeenCalled()
    expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: f.queued.id } })).state).toBe('UNKNOWN')
  })

  it('fences a late PREPARING worker after recovery has already sent the replacement attempt', async () => {
    const f = await fixture(), entered = t03Deferred<void>(), release = t03Deferred<void>()
    vi.mocked(recommendJobs).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise
      return { availability: 'ready', items: [f.job.item] }
    })
    const old = observe(f.queued.id)
    let replacement: Promise<void> | undefined
    try {
      await t03Bounded(entered.promise)
      replacement = (async () => {
        await testDb.weeklyDigestDelivery.update({ where: { id: f.queued.id }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } })
        await recoverWeeklyDigests(); await runWeeklyDigest({ deliveryId: f.queued.id })
      })()
      await t03Bounded(replacement)
      expect(mail).toHaveBeenCalledOnce()
    } finally {
      release.resolve()
      const results = await Promise.allSettled([finish(old), ...(replacement ? [t03Bounded(replacement)] : [])])
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
    expect(mail).toHaveBeenCalledOnce()
    expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: f.queued.id } })).state).toBe('SENT')
  })

  it('does not hold the delivery-row transaction while mail HTTP is pending', async () => {
    const f = await fixture(), entered = t03Deferred<void>(), release = t03Deferred<void>()
    mail.mockImplementationOnce(async () => { entered.resolve(); await release.promise })
    const work = observe(f.queued.id)
    let mutation: Promise<unknown> | undefined
    let duplicate: Promise<void> | undefined
    try {
      await t03Bounded(entered.promise)
      mutation = testDb.$transaction(tx => tx.weeklyDigestDelivery.update({ where: { id: f.queued.id }, data: { updatedAt: new Date() } }))
      await t03Bounded(mutation)
      duplicate = runWeeklyDigest({ deliveryId: f.queued.id })
      await t03Bounded(duplicate)
      expect(mail).toHaveBeenCalledOnce()
    } finally {
      release.resolve()
      const results = await Promise.allSettled([finish(work), ...(mutation ? [t03Bounded(mutation)] : []), ...(duplicate ? [t03Bounded(duplicate)] : [])])
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
  })

  it.each(['expired-week', 'exhausted-attempts'] as const)('does not dispatch %s deliveries', async reason => {
    const f = await fixture()
    await testDb.weeklyDigestDelivery.update({ where: { id: f.queued.id }, data: reason === 'expired-week'
      ? { expiresAt: new Date(Date.now() - 1_000) } : { state: 'RETRYABLE', attempts: 3, nextAttemptAt: new Date(Date.now() - 1_000) } })
    await recoverWeeklyDigests(); await runWeeklyDigest({ deliveryId: f.queued.id })
    expect(mail).not.toHaveBeenCalled()
    expect(recommendJobs).not.toHaveBeenCalled()
  })

  it.each(['ready', 'unavailable'] as const)('handles an empty %s recommendation without sending', async availability => {
    const f = await fixture()
    vi.mocked(recommendJobs).mockResolvedValue({ availability, items: [] })
    await runWeeklyDigest({ deliveryId: f.queued.id })
    expect(mail).not.toHaveBeenCalled()
    expect((await testDb.weeklyDigestDelivery.findUniqueOrThrow({ where: { id: f.queued.id } })).state).toBe(availability === 'ready' ? 'SKIPPED' : 'RETRYABLE')
  })
})
