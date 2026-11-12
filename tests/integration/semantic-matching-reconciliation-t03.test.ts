import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn() }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn().mockResolvedValue(true), findTalentNeighbors: vi.fn().mockResolvedValue([]),
  findJobNeighbors: vi.fn().mockResolvedValue([]), writeSemanticVector: vi.fn(), deleteSemanticVector: vi.fn(),
}))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { reconcileMatchingCorpus, dispatchPendingMatchingIndexes, invalidateStudentMatchingIndexTx, recommendJobs, recommendTalents,
  setMatchingConsent, getStudentMatchingUiState } from '@/server/services/semantic-matching'
import { runMatchingIndex } from '@/server/jobs/index-matching'
import { sendBoss } from '@/server/jobs/boss'
import { embedMatchingText } from '@/server/lib/ai/embedding-provider'
import { isSemanticStoreAvailable, writeSemanticVector } from '@/server/lib/semantic-store'
import { clearSettingsCache } from '@/server/services/settings'
import { lockXact, LOCK_NS } from '@/server/lib/advisory-locks'
import { seedT03Gate, t03Student, t03Employer, t03Deferred, t03Bounded,
  T03_VECTOR, T03_MODEL, T03_VERSION } from '../helpers/semantic-matching-t03'

setupTestDb()
beforeEach(() => {
  vi.clearAllMocks(); clearSettingsCache()
  vi.mocked(isSemanticStoreAvailable).mockResolvedValue(true)
  vi.mocked(sendBoss.send).mockReset().mockResolvedValue('synthetic-job')
  vi.mocked(embedMatchingText).mockReset().mockResolvedValue({ ok: true, vector: T03_VECTOR, model: T03_MODEL })
})
async function batch(size: unknown) {
  await testDb.systemSetting.upsert({ where: { key: 'ai.matching.reconcileBatchSize' },
    create: { key: 'ai.matching.reconcileBatchSize', value: size as number }, update: { value: size as number } })
}
async function sweep() { for (let n = 0; n < 4; n++) await reconcileMatchingCorpus() }

describe('M9-T03 bounded corpus discovery', () => {
  it('creates initial student and public-job QUEUED metadata without calling provider or queue', async () => {
    await seedT03Gate()
    const student = await t03Student(), employer = await t03Employer()
    const result = await reconcileMatchingCorpus()
    expect(result).toEqual({ studentsVisited: 1, jobsVisited: 1, queued: 2 })
    expect(await testDb.semanticIndex.findUnique({ where: { studentId: student.profileId } }))
      .toMatchObject({ generation: 1, state: 'QUEUED', attempts: 0 })
    expect(await testDb.semanticIndex.findUnique({ where: { jobId: employer.jobId } }))
      .toMatchObject({ generation: 1, state: 'QUEUED', consentGrantId: null })
    expect(sendBoss.send).not.toHaveBeenCalled()
    expect(embedMatchingText).not.toHaveBeenCalled()
  })

  it('leaves grant, bootstrap and recommendation queries free of metadata scheduling', async () => {
    await seedT03Gate()
    const student = await t03Student(), employer = await t03Employer()
    await getStudentMatchingUiState({ userId: student.userId })
    await recommendJobs({ userId: student.userId }, {})
    await recommendTalents(employer, { jobId: employer.jobId })
    expect(await testDb.semanticIndex.count()).toBe(0)
    expect(await testDb.matchingCorpusCursor.count()).toBe(0)
    expect(sendBoss.send).not.toHaveBeenCalled()
  })

  it.each(['off', 'store-absent', 'aborted', 'invalid-batch'] as const)('does not create progress or metadata when %s', async reason => {
    const gate = await seedT03Gate()
    await t03Student(); await t03Employer()
    if (reason === 'off') await testDb.systemSetting.update({ where: { key: 'ai.matching' }, data: { value: { ...gate, enabled: false } } })
    if (reason === 'store-absent') vi.mocked(isSemanticStoreAvailable).mockResolvedValue(false)
    if (reason === 'invalid-batch') await batch(51)
    const controller = new AbortController()
    if (reason === 'aborted') controller.abort()
    expect(await reconcileMatchingCorpus({ signal: controller.signal })).toEqual({ studentsVisited: 0, jobsVisited: 0, queued: 0 })
    expect(await testDb.semanticIndex.count()).toBe(0)
    expect(await testDb.matchingCorpusCursor.count()).toBe(0)
    expect(sendBoss.send).not.toHaveBeenCalled()
    expect(embedMatchingText).not.toHaveBeenCalled()
  })

  it.each(['hidden', 'unverified', 'incomplete', 'suspended', 'revoked', 'stale-legal'] as const)('rechecks student %s eligibility', async reason => {
    await seedT03Gate()
    const student = await t03Student()
    if (reason === 'hidden') await testDb.studentProfile.update({ where: { id: student.profileId }, data: { visibility: 'HIDDEN' } })
    if (reason === 'unverified') await testDb.studentProfile.update({ where: { id: student.profileId }, data: { schoolVerifiedAt: null } })
    if (reason === 'incomplete') await testDb.studentProfile.update({ where: { id: student.profileId }, data: { completeness: 0 } })
    if (reason === 'suspended') await testDb.user.update({ where: { id: student.userId }, data: { status: 'SUSPENDED' } })
    if (reason === 'revoked') await setMatchingConsent({ userId: student.userId }, { granted: false })
    if (reason === 'stale-legal') await testDb.consent.updateMany({ where: { userId: student.userId, type: 'PRIVACY' }, data: { granted: false } })
    expect((await reconcileMatchingCorpus()).studentsVisited).toBe(1)
    expect(await testDb.semanticIndex.count()).toBe(0)
  })

  it('preserves existing progress and cancelled metadata while the gate is closed', async () => {
    const gate = await seedT03Gate()
    const student = await t03Student()
    await reconcileMatchingCorpus()
    await testDb.$transaction(async tx => {
      await lockXact(tx, LOCK_NS.STUDENT_DATA, student.userId)
      await invalidateStudentMatchingIndexTx(tx, student.userId)
    })
    const index = await testDb.semanticIndex.findUniqueOrThrow({ where: { studentId: student.profileId } })
    const cursors = await testDb.matchingCorpusCursor.findMany({ orderBy: { kind: 'asc' } })
    await testDb.systemSetting.update({ where: { key: 'ai.matching' }, data: { value: { ...gate, enabled: false } } })
    await sweep()
    expect(await testDb.semanticIndex.findUnique({ where: { id: index.id } })).toEqual(index)
    expect(await testDb.matchingCorpusCursor.findMany({ orderBy: { kind: 'asc' } })).toEqual(cursors)
    expect(embedMatchingText).not.toHaveBeenCalled()
    expect(sendBoss.send).not.toHaveBeenCalled()
  })

  it('does not dispatch existing QUEUED work after gate closure', async () => {
    const gate = await seedT03Gate()
    await t03Student(); await reconcileMatchingCorpus()
    expect(await testDb.semanticIndex.count({ where: { state: 'QUEUED' } })).toBe(1)
    await testDb.systemSetting.update({ where: { key: 'ai.matching' }, data: { value: { ...gate, enabled: false } } })
    await dispatchPendingMatchingIndexes()
    expect(sendBoss.send).not.toHaveBeenCalled()
    expect(embedMatchingText).not.toHaveBeenCalled()
  })

  it('stops a pending dispatch batch when the gate closes after its first send', async () => {
    const gate = await seedT03Gate()
    await t03Student(); await t03Student(); await reconcileMatchingCorpus()
    expect(await testDb.semanticIndex.count({ where: { state: 'QUEUED' } })).toBe(2)
    vi.mocked(sendBoss.send).mockImplementationOnce(async () => {
      await testDb.systemSetting.update({ where: { key: 'ai.matching' }, data: { value: { ...gate, enabled: false } } })
      return 'synthetic-job'
    })
    await dispatchPendingMatchingIndexes()
    expect(sendBoss.send).toHaveBeenCalledTimes(1)
    expect(embedMatchingText).not.toHaveBeenCalled()
  })

  it.each(['closed', 'expired', 'inactive-company'] as const)('rechecks job %s eligibility', async reason => {
    await seedT03Gate()
    const employer = await t03Employer()
    if (reason === 'closed') await testDb.job.update({ where: { id: employer.jobId }, data: { status: 'CLOSED' } })
    if (reason === 'expired') await testDb.job.update({ where: { id: employer.jobId }, data: { deadline: new Date(0) } })
    if (reason === 'inactive-company') await testDb.company.update({ where: { id: employer.companyId }, data: { isActive: false } })
    expect((await reconcileMatchingCorpus()).jobsVisited).toBe(1)
    expect(await testDb.semanticIndex.count()).toBe(0)
  })

  it('does not use an arbitrary employer member grant as enduring job authorization', async () => {
    await seedT03Gate()
    const employer = await t03Employer()
    await testDb.consent.updateMany({ where: { userId: employer.userId }, data: { granted: false } })
    await testDb.user.update({ where: { id: employer.userId }, data: { status: 'SUSPENDED' } })
    await reconcileMatchingCorpus()
    expect(await testDb.semanticIndex.findUnique({ where: { jobId: employer.jobId } })).toMatchObject({ state: 'QUEUED', consentGrantId: null })
  })

  it('bounds each kind independently and advances past ineligible sources', async () => {
    await seedT03Gate(); await batch(1)
    const students = await Promise.all([t03Student(), t03Student(), t03Student()])
    students.sort((a, b) => a.profileId.localeCompare(b.profileId))
    await testDb.studentProfile.update({ where: { id: students[0]!.profileId }, data: { visibility: 'HIDDEN' } })
    const employer = await t03Employer()
    expect(await reconcileMatchingCorpus()).toEqual({ studentsVisited: 1, jobsVisited: 1, queued: 1 })
    expect(await testDb.semanticIndex.findUnique({ where: { jobId: employer.jobId } })).not.toBeNull()
    expect(await testDb.semanticIndex.count({ where: { kind: 'STUDENT' } })).toBe(0)
    await reconcileMatchingCorpus(); await reconcileMatchingCorpus()
    expect(await testDb.semanticIndex.count({ where: { kind: 'STUDENT' } })).toBe(2)
  })

  it('serializes two scanners without duplicate generations or lost cursor progress', async () => {
    await seedT03Gate(); await batch(1)
    const students = await Promise.all([t03Student(), t03Student(), t03Student()])
    students.sort((a, b) => a.profileId.localeCompare(b.profileId))
    await Promise.all([reconcileMatchingCorpus(), reconcileMatchingCorpus()])
    const indexes = await testDb.semanticIndex.findMany({ orderBy: { studentId: 'asc' } })
    expect(indexes.map(index => index.studentId)).toEqual(students.slice(0, 2).map(student => student.profileId))
    expect(indexes.every(index => index.generation === 1)).toBe(true)
    expect(await testDb.matchingCorpusCursor.findUnique({ where: { kind: 'STUDENT' } })).toMatchObject({ afterId: students[1]!.profileId })
  })

  it('does not reset current terminal FAILED attempts on each sweep', async () => {
    await seedT03Gate()
    const student = await t03Student()
    await reconcileMatchingCorpus()
    const failed = await testDb.semanticIndex.update({ where: { studentId: student.profileId },
      data: { state: 'FAILED', attempts: 3, failureCode: 'ATTEMPTS_EXHAUSTED', completedAt: new Date() } })
    await sweep()
    expect(await testDb.semanticIndex.findUnique({ where: { id: failed.id } })).toEqual(failed)
    await testDb.studentProfile.update({ where: { id: student.profileId }, data: { editRevision: { increment: 1 } } })
    await sweep()
    expect(await testDb.semanticIndex.findUnique({ where: { id: failed.id } }))
      .toMatchObject({ generation: failed.generation + 1, state: 'QUEUED', attempts: 0 })
  })

  it('keeps READY generations stable on a repeated scan', async () => {
    await seedT03Gate()
    const student = await t03Student()
    await reconcileMatchingCorpus()
    const ready = await testDb.semanticIndex.update({ where: { studentId: student.profileId }, data: { state: 'READY' } })
    await sweep()
    expect(await testDb.semanticIndex.findUnique({ where: { id: ready.id } })).toEqual(ready)
  })

  it('wraps a persisted cursor and rediscovers an earlier source after eligibility changes', async () => {
    await seedT03Gate(); await batch(1)
    const students = await Promise.all([t03Student(), t03Student()])
    students.sort((a, b) => a.profileId.localeCompare(b.profileId))
    await testDb.studentProfile.update({ where: { id: students[0]!.profileId }, data: { visibility: 'HIDDEN' } })
    await reconcileMatchingCorpus(); await reconcileMatchingCorpus()
    expect(await testDb.semanticIndex.count()).toBe(1)
    await testDb.studentProfile.update({ where: { id: students[0]!.profileId }, data: { visibility: 'PUBLIC', editRevision: { increment: 1 } } })
    expect((await reconcileMatchingCorpus()).studentsVisited).toBe(0)
    expect(await testDb.matchingCorpusCursor.findUnique({ where: { kind: 'STUDENT' } })).toMatchObject({ afterId: null })
    await reconcileMatchingCorpus()
    expect(await testDb.semanticIndex.count()).toBe(2)
    expect(await testDb.semanticIndex.findUnique({ where: { studentId: students[0]!.profileId } })).toMatchObject({ generation: 1, state: 'QUEUED' })
  })

  it('starts a fresh failed generation only after a new gate epoch is approved', async () => {
    await seedT03Gate()
    const student = await t03Student()
    await reconcileMatchingCorpus()
    const failed = await testDb.semanticIndex.update({ where: { studentId: student.profileId },
      data: { state: 'FAILED', attempts: 3, failureCode: 'ATTEMPTS_EXHAUSTED' } })
    const newGate = await seedT03Gate()
    await sweep()
    expect(await testDb.semanticIndex.findUnique({ where: { id: failed.id } }))
      .toMatchObject({ generation: failed.generation + 1, gateEpoch: newGate.epoch, state: 'QUEUED', attempts: 0 })
  })

  it('requeues after revoke/regrant using a new generation and grant id', async () => {
    await seedT03Gate()
    const student = await t03Student()
    await reconcileMatchingCorpus()
    const old = await testDb.semanticIndex.findUniqueOrThrow({ where: { studentId: student.profileId } })
    await setMatchingConsent({ userId: student.userId }, { granted: false })
    await setMatchingConsent({ userId: student.userId }, { granted: true, submittedVersion: T03_VERSION })
    await sweep()
    const current = await testDb.semanticIndex.findUniqueOrThrow({ where: { id: old.id } })
    expect(current.generation).toBe(old.generation + 2)
    expect(current.state).toBe('QUEUED')
    expect(current.consentGrantId).not.toBe(old.consentGrantId)
  })

  it('does not revive late output from a generation replaced by reconciliation', async () => {
    await seedT03Gate()
    const student = await t03Student()
    await reconcileMatchingCorpus()
    const old = await testDb.semanticIndex.findUniqueOrThrow({ where: { studentId: student.profileId } })
    const entered = t03Deferred<void>(), release = t03Deferred<void>()
    vi.mocked(embedMatchingText).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise
      return { ok: true, vector: T03_VECTOR, model: T03_MODEL }
    })
    const work = runMatchingIndex({ indexId: old.id, generation: old.generation })
    try {
      await t03Bounded(entered.promise)
      await testDb.$transaction(async tx => {
        await lockXact(tx, LOCK_NS.STUDENT_DATA, student.userId)
        await tx.studentProfile.update({ where: { id: student.profileId }, data: { editRevision: { increment: 1 } } })
        await invalidateStudentMatchingIndexTx(tx, student.userId)
      })
      await sweep()
    } finally { release.resolve(); await t03Bounded(work) }
    expect(writeSemanticVector).not.toHaveBeenCalled()
    expect(await testDb.semanticIndex.findUnique({ where: { id: old.id } }))
      .toMatchObject({ generation: old.generation + 2, state: 'QUEUED', attempts: 0 })
  })
})
