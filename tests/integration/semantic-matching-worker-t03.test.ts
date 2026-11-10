import { randomUUID } from 'node:crypto'
import { inspect } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn() }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn().mockResolvedValue(true), writeSemanticVector: vi.fn().mockResolvedValue(undefined),
  deleteSemanticVector: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { runMatchingIndex } from '@/server/jobs/index-matching'
import { requestStudentMatchingIndex, requestJobMatchingIndex, setMatchingConsent } from '@/server/services/semantic-matching'
import { clearSettingsCache } from '@/server/services/settings'
import { closeJob } from '@/server/services/jobs'
import { embedMatchingText } from '@/server/lib/ai/embedding-provider'
import { writeSemanticVector } from '@/server/lib/semantic-store'
import { logger } from '@/server/lib/logger'
import * as Sentry from '@sentry/node'
import {
  seedT03Gate, t03Student, t03Employer, t03Deferred, t03Bounded,
  T03_VECTOR, T03_MODEL, T03_VERSION, T03_CONFIG,
} from '../helpers/semantic-matching-t03'

setupTestDb()
beforeEach(() => {
  vi.clearAllMocks(); clearSettingsCache()
  vi.mocked(embedMatchingText).mockReset().mockResolvedValue({ ok: true, vector: T03_VECTOR, model: T03_MODEL })
})

async function fixture() {
  await seedT03Gate()
  const student = await t03Student()
  const request = await requestStudentMatchingIndex({ userId: student.userId })
  return { student, request }
}
function start(request: { indexId: string; generation: number }) {
  return runMatchingIndex(request).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
}
async function finish(work: ReturnType<typeof start>) {
  const result = await t03Bounded(work)
  if (!result.ok) throw result.error
}

describe('M9-T03 document-worker egress and fencing', () => {
  it('publishes a document embedding without storing the document or changing the confirmed profile', async () => {
    const f = await fixture()
    const before = await testDb.studentProfile.findUniqueOrThrow({ where: { id: f.student.profileId } })
    await finish(start(f.request))
    expect(embedMatchingText).toHaveBeenCalledOnce()
    const [input] = vi.mocked(embedMatchingText).mock.calls[0]
    expect(input).toMatchObject({ inputType: 'document', model: T03_MODEL, configurationId: T03_CONFIG })
    expect(input.text).not.toContain(f.student.name)
    expect(Object.keys(input).sort()).toEqual(['configurationId', 'inputType', 'model', 'text'])
    expect(writeSemanticVector).toHaveBeenCalledOnce()
    expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id: f.request.indexId } })).toMatchObject({
      state: 'READY', generation: f.request.generation, leaseToken: null, leaseExpiresAt: null,
    })
    expect(await testDb.studentProfile.findUniqueOrThrow({ where: { id: f.student.profileId } })).toEqual(before)
    expect(JSON.stringify(await testDb.semanticIndex.findMany())).not.toContain(input.text)
  })

  it.each(['regrant', 'new-epoch', 'career-edit', 'delete-source'] as const)('drops an old response after %s', async change => {
    const f = await fixture()
    const entered = t03Deferred<void>(), release = t03Deferred<void>()
    vi.mocked(embedMatchingText).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise
      return { ok: true, vector: T03_VECTOR, model: T03_MODEL }
    })
    const work = start(f.request)
    let mutation: Promise<unknown> | undefined
    try {
      await t03Bounded(entered.promise)
      mutation = (async () => {
        if (change === 'regrant') {
          await setMatchingConsent({ userId: f.student.userId }, { granted: false, submittedVersion: T03_VERSION })
          await setMatchingConsent({ userId: f.student.userId }, { granted: true, submittedVersion: T03_VERSION })
        }
        if (change === 'new-epoch') await testDb.systemSetting.update({ where: { key: 'ai.matching' }, data: {
          value: { enabled: true, legalVersion: T03_VERSION, epoch: randomUUID(), configurationId: T03_CONFIG },
        } })
        if (change === 'career-edit') await testDb.studentProfile.update({ where: { id: f.student.profileId }, data: { headline: 'Changed while the model waited' } })
        if (change === 'delete-source') await testDb.studentProfile.delete({ where: { id: f.student.profileId } })
      })()
      await t03Bounded(mutation)
    } finally {
      release.resolve()
      const results = await Promise.allSettled([finish(work), ...(mutation ? [t03Bounded(mutation)] : [])])
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
    expect(writeSemanticVector).not.toHaveBeenCalled()
    const row = await testDb.semanticIndex.findUnique({ where: { id: f.request.indexId } })
    expect(row?.state ?? 'DELETED').not.toBe('READY')
  })

  it('closing a job invalidates the in-flight document generation through the real lifecycle service', async () => {
    await seedT03Gate()
    const employer = await t03Employer()
    const request = await requestJobMatchingIndex(employer, { jobId: employer.jobId })
    const entered = t03Deferred<void>(), release = t03Deferred<void>()
    vi.mocked(embedMatchingText).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise
      return { ok: true, vector: T03_VECTOR, model: T03_MODEL }
    })
    const work = start(request)
    let mutation: Promise<unknown> | undefined
    try {
      await t03Bounded(entered.promise)
      mutation = closeJob({ ...employer, role: 'OWNER' }, employer.jobId)
      await t03Bounded(mutation)
      const invalidated = await testDb.semanticIndex.findUniqueOrThrow({ where: { id: request.indexId } })
      expect(invalidated.generation).toBeGreaterThan(request.generation)
      expect(invalidated.leaseToken).toBeNull()
    } finally {
      release.resolve()
      const results = await Promise.allSettled([finish(work), ...(mutation ? [t03Bounded(mutation)] : [])])
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
    expect(writeSemanticVector).not.toHaveBeenCalled()
    expect((await testDb.semanticIndex.findUniqueOrThrow({ where: { id: request.indexId } })).state).not.toBe('READY')
  })

  it.each(['success', 'failure'] as const)('old lease %s cannot overwrite a live replacement token', async late => {
    const f = await fixture()
    const enteredA = t03Deferred<void>(), enteredB = t03Deferred<void>()
    const releaseA = t03Deferred<void>(), releaseB = t03Deferred<void>()
    vi.mocked(embedMatchingText).mockImplementationOnce(async () => {
      enteredA.resolve(); await releaseA.promise
      return late === 'success' ? { ok: true, vector: T03_VECTOR, model: T03_MODEL } : { ok: false, reason: 'unavailable' }
    }).mockImplementationOnce(async () => {
      enteredB.resolve(); await releaseB.promise
      return { ok: true, vector: T03_VECTOR, model: T03_MODEL }
    })
    const first = start(f.request)
    let second: ReturnType<typeof start> | undefined
    try {
      await t03Bounded(enteredA.promise)
      const original = await testDb.semanticIndex.findUniqueOrThrow({ where: { id: f.request.indexId } })
      await testDb.semanticIndex.update({ where: { id: f.request.indexId }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } })
      second = start(f.request)
      await t03Bounded(enteredB.promise)
      const replacement = await testDb.semanticIndex.findUniqueOrThrow({ where: { id: f.request.indexId } })
      expect(replacement.leaseToken).toBeTruthy()
      expect(replacement.leaseToken).not.toBe(original.leaseToken)
      releaseA.resolve(); await finish(first)
      expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id: f.request.indexId } })).toEqual(replacement)
      expect(writeSemanticVector).not.toHaveBeenCalled()
    } finally {
      releaseA.resolve(); releaseB.resolve()
      const results = await Promise.allSettled([finish(first), ...(second ? [finish(second)] : [])])
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
    expect(writeSemanticVector).toHaveBeenCalledOnce()
    expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id: f.request.indexId } })).toMatchObject({ state: 'READY', attempts: 2 })
  })

  it('provider failures retain no raw exception, input, or response in telemetry or persisted metadata', async () => {
    const f = await fixture()
    const sentinel = 'PRIVATE_EMBEDDING_ERROR_SENTINEL'
    vi.mocked(embedMatchingText).mockRejectedValueOnce(new Error(sentinel))
    await finish(start(f.request))
    expect(writeSemanticVector).not.toHaveBeenCalled()
    const observed = inspect({
      logs: [logger.error, logger.warn, logger.info, logger.debug].map(fn => vi.mocked(fn).mock.calls),
      sentry: [vi.mocked(Sentry.captureException).mock.calls, vi.mocked(Sentry.captureMessage).mock.calls],
      metadata: await testDb.semanticIndex.findMany(), audit: await testDb.auditLog.findMany(),
    }, { depth: 20, maxStringLength: Infinity })
    expect(observed).not.toContain(sentinel)
    expect(observed).not.toContain(f.student.name)
  })
})
