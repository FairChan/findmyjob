import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
const ports = vi.hoisted(() => ({
  available: true, vectors: new Map<string, number>(), failures: new Set<string>(),
  remove: vi.fn(), snapshotHook: undefined as undefined | (() => Promise<void>),
  failureHook: undefined as undefined | (() => Promise<void>),
}))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  const index = new Proxy(testDb.semanticIndex, { get(target, key, receiver) {
    if (key === 'findMany') return async (args: unknown) => {
      const rows = await Reflect.apply(target.findMany, target, [args])
      if (ports.snapshotHook) { const hook = ports.snapshotHook; ports.snapshotHook = undefined; await hook() }
      return rows
    }
    return Reflect.get(target, key, receiver)
  } })
  return { db: new Proxy(testDb, { get(target, key, receiver) {
    if (key === 'semanticIndex') return index
    if (key === '$transaction') return async (...args: unknown[]) => {
      try { return await Reflect.apply(target.$transaction, target, args) }
      catch (error) {
        if (ports.failureHook) { const hook = ports.failureHook; ports.failureHook = undefined; await hook() }
        throw error
      }
    }
    return Reflect.get(target, key, receiver)
  } }) }
})
vi.mock('@/env', () => ({ env: { VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model' } }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic') } }))
vi.mock('@/server/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn(async () => ports.available),
  deleteSemanticVector: ports.remove, writeSemanticVector: vi.fn(), findTalentNeighbors: vi.fn(), findJobNeighbors: vi.fn(),
}))
import { setupTestDb, testDb } from '../setup/db'
import { createEmployer, createJob } from '../factories'
import { dispatchPendingMatchingIndexes, requestStudentMatchingIndex, setMatchingConsent } from '@/server/services/semantic-matching'
import { clearSettingsCache } from '@/server/services/settings'
import { seedT03Gate, t03Student, t03Bounded, T03_VERSION } from '../helpers/semantic-matching-t03'
setupTestDb()
beforeEach(() => {
  clearSettingsCache(); ports.available = true; ports.vectors.clear(); ports.failures.clear(); ports.snapshotHook = undefined; ports.failureHook = undefined
  ports.remove.mockReset().mockImplementation(async (_tx: unknown, id: string) => {
    if (ports.failures.has(id)) throw new Error('SYNTHETIC_DELETE_FAILURE')
    ports.vectors.delete(id)
  })
})
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }
async function cancelled(count: number) {
  const employer = await createEmployer(testDb), ids: string[] = []
  for (let n = 0; n < count; n++) {
    const job = await createJob(testDb, employer.companyId, employer.userId)
    const id = 'c' + String(n + 1).padStart(24, '0')
    await testDb.semanticIndex.create({ data: { id, kind: 'JOB', jobId: job.id, generation: 2, state: 'CANCELLED',
      sourceHash: 'a'.repeat(64), sourceRevision: 0, configurationId: 'matching-public-v1', model: 'synthetic',
      gateEpoch: '00000000-0000-4000-8000-000000000000', legalVersion: 'synthetic', completedAt: new Date() } })
    ids.push(id); ports.vectors.set(id, 2)
  }
  return ids
}
describe('T03-R1 cancelled cleanup rotates durable probes, without a completion claim', () => {
  it('cleans the 51st vector after a bounded first batch instead of revisiting the same oldest 50', async () => {
    const ids = await cancelled(51)
    await dispatchPendingMatchingIndexes()
    expect(ports.remove).toHaveBeenCalledTimes(50)
    expect(ports.vectors.has(ids[50])).toBe(true)
    await dispatchPendingMatchingIndexes()
    expect(ports.vectors.size).toBe(0)
    expect(ports.remove).toHaveBeenCalledTimes(51)
    const rows = await testDb.semanticIndex.findMany()
    expect(rows.every(row => row.state === 'CANCELLED' && row.generation === 2 && row.nextAttemptAt !== null)).toBe(true)
    expect(rows.every(row => row.nextAttemptAt!.getTime() > Date.now() + 23 * 60 * 60 * 1000)).toBe(true)
    expect(rows.every(row => row.attempts === 0)).toBe(true)
  })
  it('moves failed head rows to a five-minute retry and visits the remaining row', async () => {
    const ids = await cancelled(51)
    ids.slice(0, 50).forEach(id => ports.failures.add(id))
    await dispatchPendingMatchingIndexes()
    await dispatchPendingMatchingIndexes()
    expect(ports.vectors.has(ids[50])).toBe(false)
    expect(ports.vectors.size).toBe(50)
    const failed = await testDb.semanticIndex.findUniqueOrThrow({ where: { id: ids[0] } })
    expect(failed.state).toBe('CANCELLED')
    expect(failed.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000)
    ports.failures.clear()
    await testDb.semanticIndex.updateMany({ where: { id: { in: ids.slice(0, 50) } }, data: { nextAttemptAt: new Date(Date.now() - 1) } })
    await dispatchPendingMatchingIndexes()
    expect(ports.vectors.size).toBe(0)
  })
  it('does not record a successful probe without vector capability and resumes after recovery', async () => {
    const ids = await cancelled(51); ports.available = false
    await dispatchPendingMatchingIndexes()
    expect(ports.remove).not.toHaveBeenCalled()
    expect(await testDb.semanticIndex.count({ where: { nextAttemptAt: null } })).toBe(51)
    ports.available = true
    await dispatchPendingMatchingIndexes(); await dispatchPendingMatchingIndexes()
    expect(ports.vectors.size).toBe(0)
    expect((await testDb.semanticIndex.findUniqueOrThrow({ where: { id: ids[0] } })).state).toBe('CANCELLED')
  })
  it('capability disappearing after the outer probe reaches the real delete helper and uses failure retry', async () => {
    const [id] = await cancelled(1)
    ports.remove.mockImplementationOnce(async (tx: unknown, indexId: string) => {
      const actual = await vi.importActual<typeof import('@/server/lib/semantic-store')>('@/server/lib/semantic-store')
      const capabilityLost = new Proxy(tx as Prisma.TransactionClient, { get(target, key, receiver) {
        return key === '$queryRaw' ? vi.fn().mockResolvedValue([{ available: false }]) : Reflect.get(target, key, receiver)
      } })
      await actual.deleteSemanticVector(capabilityLost, indexId)
    })
    await dispatchPendingMatchingIndexes()
    expect(ports.vectors.get(id)).toBe(2)
    const row = await testDb.semanticIndex.findUniqueOrThrow({ where: { id } })
    expect(row).toMatchObject({ state: 'CANCELLED', generation: 2, attempts: 0 })
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000)
    expect(row.nextAttemptAt!.getTime()).toBeLessThan(Date.now() + 6 * 60 * 1000)
  })
  it('rechecks a stale cancelled scan under the real source/metadata locks before deleting a reauthorized generation', async () => {
    const [id] = await cancelled(1), scanned = deferred(), release = deferred()
    ports.snapshotHook = async () => { scanned.resolve(); await release.promise }
    const running = dispatchPendingMatchingIndexes()
    try {
      await t03Bounded(scanned.promise)
      await testDb.semanticIndex.update({ where: { id }, data: { state: 'READY', generation: 3, nextAttemptAt: null } })
      ports.vectors.set(id, 3)
    } finally { release.resolve(); await running }
    expect(ports.remove).not.toHaveBeenCalled()
    expect(ports.vectors.get(id)).toBe(3)
    expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id } })).toMatchObject({ state: 'READY', generation: 3, nextAttemptAt: null })
  })
  it('a failed old delete cannot reschedule a newer cancelled generation', async () => {
    const [id] = await cancelled(1), rolledBack = deferred(), release = deferred()
    ports.failures.add(id)
    ports.failureHook = async () => { rolledBack.resolve(); await release.promise }
    const running = dispatchPendingMatchingIndexes(), ownProbe = new Date(Date.now() + 17 * 60 * 1000)
    try {
      await t03Bounded(rolledBack.promise)
      await testDb.semanticIndex.update({ where: { id }, data: { generation: 4, nextAttemptAt: ownProbe } })
      ports.vectors.set(id, 4)
    } finally { release.resolve(); await running }
    expect(ports.vectors.get(id)).toBe(4)
    expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id } })).toMatchObject({ state: 'CANCELLED', generation: 4, nextAttemptAt: ownProbe })
  })
  it('a real revoke/regrant/new index generation resets the old cleanup probe time', async () => {
    await seedT03Gate(); const student = await t03Student()
    const initial = await requestStudentMatchingIndex({ userId: student.userId })
    await setMatchingConsent({ userId: student.userId }, { granted: false, submittedVersion: T03_VERSION })
    const cancelledIndex = await testDb.semanticIndex.findUniqueOrThrow({ where: { id: initial.indexId } })
    expect(cancelledIndex.nextAttemptAt).not.toBeNull()
    await setMatchingConsent({ userId: student.userId }, { granted: true, submittedVersion: T03_VERSION })
    const next = await requestStudentMatchingIndex({ userId: student.userId })
    expect(next.generation).toBeGreaterThan(cancelledIndex.generation)
    expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id: next.indexId } })).toMatchObject({ state: 'QUEUED', nextAttemptAt: null, attempts: 0, leaseToken: null })
  })
})
