import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-queue-job'),
} }))
vi.mock('@/server/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }))
vi.mock('@/lib/storage', () => ({
  getObjectBytes: vi.fn(), deleteAllVersions: vi.fn().mockResolvedValue(undefined),
} ))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-test-key', AI_MODEL_PARSE: 'synthetic-test-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { bounded, observe, reachBarrier } from '../helpers/data-export-barriers-t01'
import { seedT01Gate, seedT01Resume, seedT01Student, T01_BYTES, T01_HASH, T01_VERSION } from '../helpers/resume-parsing-t01'
import { getObjectBytes } from '@/lib/storage'
import { sendBoss } from '@/server/jobs/boss'
import { checkRateLimit } from '@/server/lib/rate-limit'
import { lockXact, LOCK_NS } from '@/server/lib/advisory-locks'
import * as resumeText from '@/server/lib/resume-text'
import { requestDeletion } from '@/server/services/data-rights'
import { requestResumeParse, setResumeParseConsent } from '@/server/services/resume-parsing'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache()
  vi.mocked(getObjectBytes).mockReset().mockResolvedValue(T01_BYTES)
})
afterEach(() => { vi.restoreAllMocks() })

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

async function fixture() {
  const gate = await seedT01Gate()
  const student = await seedT01Student()
  const resume = await seedT01Resume(student)
  await testDb.resumeFile.update({ where: { id: resume.id }, data: { contentSha256: null } })
  return { gate, student, resume, ctx: { userId: student.userId } }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

async function noRequestEffects(f: Fixture, expectedReads = 0) {
  expect(getObjectBytes).toHaveBeenCalledTimes(expectedReads)
  expect(await testDb.resumeParseDraft.findUnique({ where: { resumeId: f.resume.id } })).toBeNull()
  expect(checkRateLimit).not.toHaveBeenCalled()
  expect(sendBoss.start).not.toHaveBeenCalled()
  expect(sendBoss.send).not.toHaveBeenCalled()
}

// The spy observes admission without replacing its real FIFO slot or adding sleeps.
async function whileWaiting(f: Fixture, mutation: () => Promise<unknown>, expectedCode: string, expectedReads = 0) {
  const occupied = deferred(), release = deferred(), queued = deferred()
  const admission = resumeText.withResumeTextSlot
  const holder = observe(admission(async () => { occupied.resolve(); await release.promise }, {
    signal: new AbortController().signal,
  }))
  let running: Promise<unknown> | undefined
  try {
    await reachBarrier(occupied.promise, holder, 'Occupying real resume admission')
    vi.spyOn(resumeText, 'withResumeTextSlot').mockImplementation((work, options) => {
      const pending = admission(work, options)
      // takeAdmission has synchronously queued this call before returning its promise.
      queued.resolve()
      return pending
    })
    running = observe(requestResumeParse(f.ctx, { resumeId: f.resume.id }))
    await reachBarrier(queued.promise, running, 'Legacy request waiting for admission')
    await noRequestEffects(f)
    // A lifecycle mutation must commit while the request waits, without a held user lock.
    await bounded(mutation(), 'Lifecycle change while legacy request waits')
    release.resolve()
    await expect(bounded(running, 'Invalidated legacy request')).rejects.toMatchObject({ code: expectedCode })
    await noRequestEffects(f, expectedReads)
  } finally {
    release.resolve()
    await bounded(Promise.allSettled(running ? [holder, running] : [holder]), 'Releasing real admission')
  }
}

describe('M9-T01 legacy hash admission authorization', () => {
  it.each([
    { change: 'revoke', code: 'FORBIDDEN' },
    { change: 'delete', code: 'FORBIDDEN' },
    { change: 'epoch', code: 'CONFLICT' },
    { change: 'regrant', code: 'CONFLICT' },
    { change: 'legal', code: 'VERSION_MISMATCH' },
    { change: 'gate-off', code: 'FEATURE_DISABLED' },
    { change: 'source-key', code: 'CONFLICT' },
    { change: 'source-owner', code: 'NOT_FOUND' },
    { change: 'source-delete', code: 'NOT_FOUND' },
  ])('rejects $change committed during admission wait before any S3 read', async ({ change, code }) => {
    const f = await fixture()
    const other = change === 'source-owner' ? await seedT01Student() : null
    await expect(whileWaiting(f, async () => {
      if (change === 'revoke' || change === 'regrant') {
        await setResumeParseConsent(f.ctx, { granted: false, submittedVersion: T01_VERSION })
        if (change === 'regrant') await setResumeParseConsent(f.ctx, { granted: true, submittedVersion: T01_VERSION })
      } else if (change === 'delete') await requestDeletion(f.ctx)
      else if (change === 'epoch' || change === 'gate-off') {
        await testDb.systemSetting.update({ where: { key: 'ai.resumeParse' }, data: { value: {
          ...f.gate, enabled: change !== 'gate-off', epoch: randomUUID(),
        } } })
      } else if (change === 'legal') {
        await testDb.systemSetting.update({ where: { key: 'legal.currentVersion' }, data: { value: 'synthetic-next-policy' } })
      } else if (change === 'source-delete') await testDb.resumeFile.delete({ where: { id: f.resume.id } })
      else await testDb.resumeFile.update({ where: { id: f.resume.id }, data: {
        ...(change === 'source-key' ? { storageKey: `${f.resume.storageKey}.replaced` } : {}),
        ...(change === 'source-owner' ? { studentId: other!.profileId } : {}),
      } })
    }, code)).resolves.toBeUndefined()
  })

  it('verifies a newly populated hash against bytes and rejects a mismatch without a draft or charge', async () => {
    const f = await fixture()
    await expect(whileWaiting(f, () => testDb.resumeFile.update({
      where: { id: f.resume.id }, data: { contentSha256: 'e'.repeat(64) },
    }), 'CONFLICT', 1)).resolves.toBeUndefined()
  })

  it('reuses the same generation when another legacy request populates the hash while waiting', async () => {
    const f = await fixture()
    const occupied = deferred(), release = deferred(), firstQueued = deferred(), secondQueued = deferred()
    const middleEntered = deferred(), releaseMiddle = deferred()
    const admission = resumeText.withResumeTextSlot
    const signal = new AbortController().signal
    const holder = observe(admission(async () => { occupied.resolve(); await release.promise }, { signal }))
    let first: ReturnType<typeof requestResumeParse> | undefined
    let second: ReturnType<typeof requestResumeParse> | undefined
    let middle: Promise<void> | undefined
    try {
      await reachBarrier(occupied.promise, holder, 'Initial admission holder')
      let queued = 0
      vi.spyOn(resumeText, 'withResumeTextSlot').mockImplementation((work, options) => {
        const pending = admission(work, options)
        if (++queued === 1) firstQueued.resolve(); else secondQueued.resolve()
        return pending
      })
      first = observe(requestResumeParse(f.ctx, { resumeId: f.resume.id }))
      await reachBarrier(firstQueued.promise, first, 'First legacy request queued')
      middle = observe(admission(async () => { middleEntered.resolve(); await releaseMiddle.promise }, { signal }))
      second = observe(requestResumeParse(f.ctx, { resumeId: f.resume.id }))
      await reachBarrier(secondQueued.promise, second, 'Second legacy request queued after middle holder')
      release.resolve()
      await reachBarrier(middleEntered.promise, middle, 'First request finished reading')
      const result = await bounded(first, 'First request committed known hash and draft')
      expect(result).toMatchObject({ generation: 1, state: 'QUEUED' })
      releaseMiddle.resolve()
      await expect(bounded(second, 'Concurrent legacy replay')).resolves.toMatchObject({ generation: 1, state: 'QUEUED' })
      expect(await testDb.resumeParseDraft.count({ where: { resumeId: f.resume.id } })).toBe(1)
      expect(checkRateLimit).toHaveBeenCalledOnce()
      expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: f.resume.id } })).contentSha256).toBe(T01_HASH)
    } finally {
      release.resolve(); releaseMiddle.resolve()
      await bounded(Promise.allSettled([holder, ...[first, second, middle].filter(value => value !== undefined)]), 'Release concurrent admission holders')
    }
  })

  it('hashes a valid legacy source once outside the lifecycle transaction and charges once', async () => {
    const f = await fixture()
    vi.mocked(getObjectBytes).mockImplementationOnce(async () => {
      // If the pre-read transaction still holds STUDENT_DATA this cannot acquire it.
      await bounded(testDb.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
        await lockXact(tx, LOCK_NS.STUDENT_DATA, f.student.userId)
      }), 'Lifecycle lock released before S3')
      return T01_BYTES
    })
    await expect(requestResumeParse(f.ctx, { resumeId: f.resume.id }))
      .resolves.toMatchObject({ generation: 1, state: 'QUEUED', dispatch: 'submitted' })
    expect(getObjectBytes).toHaveBeenCalledExactlyOnceWith(f.resume.storageKey, {
      maxBytes: 5 * 1024 * 1024, signal: expect.any(AbortSignal),
    })
    expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: f.resume.id } })).contentSha256).toBe(T01_HASH)
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } }))
      .toMatchObject({ generation: 1, state: 'QUEUED', sourceSha256: T01_HASH })
    expect(checkRateLimit).toHaveBeenCalledExactlyOnceWith(`resume-parse:${f.student.userId}`, { windowMs: 3_600_000, limit: 3 })
    expect(sendBoss.send).toHaveBeenCalledExactlyOnceWith('resume-parse', { resumeId: f.resume.id, generation: 1 })
  })

  it('retains the post-read authorization check when consent is revoked during S3', async () => {
    const f = await fixture()
    vi.mocked(getObjectBytes).mockImplementationOnce(async () => {
      await setResumeParseConsent(f.ctx, { granted: false, submittedVersion: T01_VERSION })
      return T01_BYTES
    })
    await expect(requestResumeParse(f.ctx, { resumeId: f.resume.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(getObjectBytes).toHaveBeenCalledOnce()
    expect(await testDb.resumeParseDraft.findUnique({ where: { resumeId: f.resume.id } })).toBeNull()
    expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: f.resume.id } })).contentSha256).toBeNull()
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(sendBoss.start).not.toHaveBeenCalled()
    expect(sendBoss.send).not.toHaveBeenCalled()
  })
})
