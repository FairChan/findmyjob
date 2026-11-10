import { beforeEach, describe, expect, it, vi } from 'vitest'
const config = vi.hoisted(() => ({ model: 'synthetic-embedding-model' }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn() }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn().mockResolvedValue(true), findTalentNeighbors: vi.fn(), findJobNeighbors: vi.fn(),
  writeSemanticVector: vi.fn().mockResolvedValue(undefined), deleteSemanticVector: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', get AI_MODEL_EMBED() { return config.model } } }
})

import { setupTestDb, testDb } from '../setup/db'
import { runMatchingIndex } from '@/server/jobs/index-matching'
import {
  recommendJobs, recommendTalents, requestStudentMatchingIndex, requestJobMatchingIndex,
  setMatchingConsent, getStudentMatchingUiState,
} from '@/server/services/semantic-matching'
import { embedMatchingText } from '@/server/lib/ai/embedding-provider'
import { writeSemanticVector, deleteSemanticVector, findTalentNeighbors, findJobNeighbors } from '@/server/lib/semantic-store'
import { sendBoss } from '@/server/jobs/boss'
import { clearSettingsCache } from '@/server/services/settings'
import {
  seedT03Gate, t03Student, t03Employer, readyT03Student, t03Neighbor, t03Deferred, t03Bounded,
  T03_VECTOR, T03_MODEL, T03_VERSION,
} from '../helpers/semantic-matching-t03'

setupTestDb()
beforeEach(() => {
  vi.clearAllMocks(); clearSettingsCache(); config.model = T03_MODEL
  vi.mocked(embedMatchingText).mockReset().mockResolvedValue({ ok: true, vector: T03_VECTOR, model: T03_MODEL })
  vi.mocked(findTalentNeighbors).mockReset().mockResolvedValue([])
  vi.mocked(findJobNeighbors).mockReset().mockResolvedValue([])
  vi.mocked(deleteSemanticVector).mockReset().mockResolvedValue(undefined)
  vi.mocked(sendBoss.send).mockReset().mockResolvedValue('synthetic-job')
})

describe('M9-T03 model and revision fences', () => {
  it.each(['environment-model', 'student-revision', 'job-revision'] as const)('rejects late document output after %s changes with unchanged projection', async change => {
    await seedT03Gate()
    const student = await t03Student()
    const employer = await t03Employer()
    const request = change === 'job-revision'
      ? await requestJobMatchingIndex(employer, { jobId: employer.jobId })
      : await requestStudentMatchingIndex({ userId: student.userId })
    const entered = t03Deferred<void>(), release = t03Deferred<void>()
    vi.mocked(embedMatchingText).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise
      return { ok: true, vector: T03_VECTOR, model: T03_MODEL }
    })
    const work = runMatchingIndex(request).then(() => null, error => error)
    try {
      await t03Bounded(entered.promise)
      if (change === 'environment-model') config.model = 'synthetic-replacement-model'
      if (change === 'student-revision') await testDb.studentProfile.update({ where: { id: student.profileId }, data: { editRevision: { increment: 1 } } })
      if (change === 'job-revision') await testDb.job.update({ where: { id: employer.jobId }, data: { matchingRevision: { increment: 1 } } })
    } finally { release.resolve(); expect(await t03Bounded(work)).toBeNull() }
    expect(writeSemanticVector).not.toHaveBeenCalled()
    expect((await testDb.semanticIndex.findUniqueOrThrow({ where: { id: request.indexId } })).state).toBe('CANCELLED')
  })

  it('does not return a query result after only its student revision changes', async () => {
    await seedT03Gate()
    const student = await t03Student()
    const entered = t03Deferred<void>(), release = t03Deferred<void>()
    vi.mocked(embedMatchingText).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise
      return { ok: true, vector: T03_VECTOR, model: T03_MODEL }
    })
    const work = recommendJobs({ userId: student.userId }, {}).then(value => ({ value, error: null }), error => ({ value: null, error }))
    try {
      await t03Bounded(entered.promise)
      await testDb.studentProfile.update({ where: { id: student.profileId }, data: { editRevision: { increment: 1 } } })
    } finally { release.resolve() }
    expect((await t03Bounded(work)).error).toMatchObject({ code: 'CONFLICT' })
    expect(findJobNeighbors).not.toHaveBeenCalled()
  })

  it('rechecks the requester after asynchronous ranking', async () => {
    await seedT03Gate()
    const employer = await t03Employer(), student = await t03Student()
    const index = await readyT03Student(student)
    vi.mocked(findTalentNeighbors).mockImplementationOnce(async () => {
      await testDb.companyMember.delete({ where: { userId: employer.userId } })
      return [t03Neighbor(index, student.profileId)]
    })
    await expect(recommendTalents(employer, { jobId: employer.jobId })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('returns unavailable when the optional store disappears after query embedding', async () => {
    await seedT03Gate()
    const student = await t03Student()
    vi.mocked(findJobNeighbors).mockRejectedValueOnce(new Error('synthetic-store-gone'))
    await expect(recommendJobs({ userId: student.userId }, {})).resolves.toEqual({ items: [], availability: 'unavailable' })
    expect(await testDb.jobView.count()).toBe(0)
  })

  it('commits versionless withdrawal and invalidation when vector cleanup fails and settings are invalid', async () => {
    await seedT03Gate()
    const student = await t03Student(), index = await readyT03Student(student)
    for (const key of ['ai.matching', 'legal.currentVersion']) await testDb.systemSetting.update({ where: { key }, data: { value: { invalid: true } } })
    expect(await getStudentMatchingUiState({ userId: student.userId })).toEqual({
      available: false, consentGranted: true, consentCurrent: false, legalVersion: null,
    })
    vi.mocked(deleteSemanticVector).mockRejectedValueOnce(new Error('PRIVATE_VECTOR_CLEANUP_SENTINEL'))
    await expect(setMatchingConsent({ userId: student.userId }, { granted: false })).resolves.toBeUndefined()
    expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id: index.id } })).toMatchObject({
      state: 'CANCELLED', generation: index.generation + 1, leaseToken: null, leaseExpiresAt: null,
    })
    expect(await testDb.consent.findFirst({ where: { userId: student.userId, type: 'AI_MATCHING' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }))
      .toMatchObject({ granted: false, version: T03_VERSION })
  })

  it('retains a durable QUEUED generation after a failed transport without leaking source into the payload', async () => {
    await seedT03Gate()
    const student = await t03Student()
    vi.mocked(sendBoss.send).mockRejectedValueOnce(new Error('PRIVATE_QUEUE_SENTINEL'))
    const request = await requestStudentMatchingIndex({ userId: student.userId })
    expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id: request.indexId } })).toMatchObject({ state: 'QUEUED', generation: request.generation })
    expect(vi.mocked(sendBoss.send).mock.calls[0]!.slice(0, 2)).toEqual(['matching-index', request])
    expect(embedMatchingText).not.toHaveBeenCalled()
  })

  it('does not claim or embed an already-aborted job', async () => {
    await seedT03Gate()
    const student = await t03Student(), request = await requestStudentMatchingIndex({ userId: student.userId })
    const before = await testDb.semanticIndex.findUniqueOrThrow({ where: { id: request.indexId } })
    const controller = new AbortController(); controller.abort()
    await runMatchingIndex(request, { signal: controller.signal })
    expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id: request.indexId } })).toEqual(before)
    expect(embedMatchingText).not.toHaveBeenCalled()
  })
})
