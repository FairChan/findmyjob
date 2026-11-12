import { randomUUID } from 'node:crypto'
import { inspect } from 'node:util'
import type { Prisma } from '@prisma/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/lib/storage', () => ({
  getObjectBytes: vi.fn().mockResolvedValue(Buffer.from('synthetic resume')),
  putObject: vi.fn().mockResolvedValue(undefined), deleteAllVersions: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job'),
} }))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { bounded, finishAll, observe, reachBarrier } from '../helpers/data-export-barriers-t01'
import { runExportUserData } from '@/server/jobs/export-user-data'
import {
  claimDataExport, beginDataExportUpload, acknowledgeDataExportUpload, settleDataExport,
  cleanupDataExport, recoverDataExports, invalidateUserExportsTx,
} from '@/server/services/data-export-artifacts'
import * as locks from '@/server/lib/advisory-locks'
import { putObject, deleteAllVersions } from '@/lib/storage'
import { sendNotificationEmail } from '@/server/services/notify'
import { sendBoss } from '@/server/jobs/boss'
import { logger } from '@/server/lib/logger'

setupTestDb()
beforeEach(() => { vi.clearAllMocks(); vi.mocked(putObject).mockReset().mockResolvedValue(undefined); vi.mocked(deleteAllVersions).mockReset().mockResolvedValue(undefined) })
afterEach(() => vi.restoreAllMocks())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function fixture() {
  const student = await createStudent(testDb)
  const request = await testDb.dataRequest.create({ data: { userId: student.userId, type: 'EXPORT' } })
  return { student, request, payload: { userId: student.userId, requestId: request.id } }
}
async function expire(requestId: string, artifactId: string) {
  const past = new Date(Date.now() - 60_000)
  await testDb.dataRequest.update({ where: { id: requestId }, data: { exportLeaseExpiresAt: past } })
  await testDb.dataExportArtifact.update({ where: { id: artifactId }, data: { leaseExpiresAt: past } })
}
async function invalidate(userId: string) {
  await testDb.$transaction(async tx => {
    await locks.lockXact(tx, locks.LOCK_NS.STUDENT_DATA, userId)
    await locks.lockXact(tx, locks.LOCK_NS.DATA_EXPORT, userId)
    await tx.user.update({ where: { id: userId }, data: { status: 'DELETED', email: `deleted-${userId}@purged.internal` } })
    await invalidateUserExportsTx(tx, userId)
  })
}

describe('T01 physical export artifacts and publication', () => {
  it.each(['wrong-owner', 'wrong-type', 'inactive'] as const)('does not reserve or upload for %s', async boundary => {
    const f = await fixture()
    let userId = f.student.userId
    if (boundary === 'wrong-owner') userId = (await createStudent(testDb)).userId
    if (boundary === 'wrong-type') await testDb.dataRequest.update({ where: { id: f.request.id }, data: { type: 'CORRECT' } })
    if (boundary === 'inactive') await testDb.user.update({ where: { id: userId }, data: { status: 'DELETED' } })
    await runExportUserData({ requestId: f.request.id, userId })
    expect(putObject).not.toHaveBeenCalled()
    expect(await testDb.dataExportArtifact.count()).toBe(0)
  })

  it('a duplicate active lease cannot start a second PUT', async () => {
    const f = await fixture()
    const entered = deferred<string>()
    const release = deferred<void>()
    vi.mocked(putObject).mockImplementationOnce(async key => { entered.resolve(key); await release.promise })
    const running = observe(runExportUserData(f.payload))
    const pending: Promise<unknown>[] = [running]
    try {
      await reachBarrier(entered.promise, running, 'First export PUT')
      const duplicate = observe(runExportUserData(f.payload))
      pending.push(duplicate)
      await bounded(duplicate, 'Duplicate export during held PUT')
      expect(putObject).toHaveBeenCalledTimes(1)
      expect(await bounded(testDb.dataExportArtifact.count({ where: { requestId: f.request.id } }), 'Reserved artifact count')).toBe(1)
    } finally { release.resolve(); await finishAll(pending, 'First export completion') }
  })

  it.each(['success', 'failure'] as const)('expired old PUT %s cannot overwrite or delete the newer DONE winner', async outcome => {
    const f = await fixture()
    const entered = deferred<string>()
    const release = deferred<void>()
    vi.mocked(putObject).mockImplementationOnce(async key => {
      entered.resolve(key); await release.promise
      if (outcome === 'failure') throw new Error('synthetic-late-sensitive-error')
    })
    const oldRun = runExportUserData(f.payload).catch(() => undefined)
    const pending: Promise<unknown>[] = [oldRun]
    try {
      const oldKey = await reachBarrier(entered.promise, oldRun, 'Old export PUT')
      const old = await bounded(testDb.dataExportArtifact.findUniqueOrThrow({ where: { storageKey: oldKey } }), 'Old artifact lookup')
      const expiring = observe(expire(f.request.id, old.id))
      pending.push(expiring)
      await bounded(expiring, 'Expire old export while PUT is held')
      const replacement = observe(runExportUserData(f.payload))
      pending.push(replacement)
      await bounded(replacement, 'Replacement export while old PUT is held')
      const winner = await bounded(testDb.dataRequest.findUniqueOrThrow({ where: { id: f.request.id } }), 'Winner lookup')
      expect(winner.status).toBe('DONE')
      expect(winner.resultKey).not.toBe(oldKey)
      release.resolve(); await bounded(oldRun, 'Late old export completion')
      const final = await testDb.dataRequest.findUniqueOrThrow({ where: { id: f.request.id } })
      expect(final).toMatchObject({ status: 'DONE', resultKey: winner.resultKey, resolvedAt: winner.resolvedAt })
      expect(vi.mocked(deleteAllVersions).mock.calls.every(([key]) => key !== winner.resultKey)).toBe(true)
      expect(vi.mocked(sendNotificationEmail).mock.calls.filter(([, input]) => input.template === 'data-export-ready')).toHaveLength(1)
      expect((await testDb.dataExportArtifact.findUniqueOrThrow({ where: { id: old.id } })).state)
        .toBe(outcome === 'success' ? 'CLEANED' : 'CLEANUP_REQUIRED')
    } finally { release.resolve(); await finishAll(pending, 'Old export cleanup') }
  })

  it('tracks two losing physical keys separately while preserving a third winner', async () => {
    const f = await fixture()
    const first = (await claimDataExport(f.payload))!
    expect(await beginDataExportUpload(first)).toBe(true)
    await expire(f.request.id, first.id)
    const second = (await claimDataExport(f.payload))!
    expect(await beginDataExportUpload(second)).toBe(true)
    await expire(f.request.id, second.id)
    await runExportUserData(f.payload)
    const winner = await testDb.dataRequest.findUniqueOrThrow({ where: { id: f.request.id } })
    expect(new Set([first.storageKey, second.storageKey, winner.resultKey]).size).toBe(3)
    for (const loser of [first, second]) {
      await acknowledgeDataExportUpload(loser.id, f.student.userId)
      expect(await settleDataExport(loser.id, f.student.userId, false)).toBe('CLEANUP_REQUIRED')
      await cleanupDataExport(loser.id, f.student.userId)
    }
    expect(await testDb.dataExportArtifact.count({ where: { requestId: f.request.id } })).toBe(3)
    expect((await testDb.dataRequest.findUniqueOrThrow({ where: { id: f.request.id } })).resultKey).toBe(winner.resultKey)
    expect(vi.mocked(deleteAllVersions).mock.calls.map(([key]) => key)).toEqual(expect.arrayContaining([first.storageKey, second.storageKey]))
    expect(vi.mocked(deleteAllVersions).mock.calls.map(([key]) => key)).not.toContain(winner.resultKey)
  })

  it('reconciles a real committed publication whose transaction response is lost', async () => {
    const f = await fixture()
    type Tx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => Promise<T>
    const realTransaction = testDb.$transaction.bind(testDb) as Tx
    let lost = false
    const uncertainTransaction: Tx = async (fn, options) => {
      const committed = await realTransaction(fn, options)
      if (!lost && committed === 'PUBLISHED') { lost = true; throw new Error('synthetic-commit-response-secret') }
      return committed
    }
    vi.spyOn(testDb, '$transaction').mockImplementation(uncertainTransaction as typeof testDb.$transaction)
    await runExportUserData(f.payload)
    expect(lost).toBe(true)
    const request = await testDb.dataRequest.findUniqueOrThrow({ where: { id: f.request.id } })
    expect(request.status).toBe('DONE')
    expect((await testDb.dataExportArtifact.findUniqueOrThrow({ where: { storageKey: request.resultKey! } })).state).toBe('PUBLISHED')
    expect(deleteAllVersions).not.toHaveBeenCalled()
    expect(inspect(vi.mocked(logger.warn).mock.calls)).not.toContain('synthetic-commit-response-secret')
  })

  it('does no deletion when fresh reconciliation cannot read persistent state', async () => {
    const f = await fixture()
    vi.mocked(putObject).mockImplementationOnce(async () => {
      vi.spyOn(testDb, '$transaction').mockRejectedValue(new Error('synthetic-db-secret'))
      throw new Error('synthetic-provider-secret')
    })
    await expect(runExportUserData(f.payload)).rejects.toThrow('DATA_EXPORT_RETRY_REQUIRED')
    expect(deleteAllVersions).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    const row = await testDb.dataExportArtifact.findFirstOrThrow({ where: { requestId: f.request.id } })
    expect(row).toMatchObject({ state: 'UPLOADING', uploadOutcome: 'UNKNOWN' })
    expect(inspect([vi.mocked(logger.error).mock.calls, vi.mocked(logger.warn).mock.calls])).not.toContain('synthetic-db-secret')
  })

  it('an unknown PUT retains cleanup after DELETE and can remove a later remote completion', async () => {
    const f = await fixture()
    const objects = new Set<string>()
    let lateKey = ''
    vi.mocked(putObject).mockImplementationOnce(async key => { lateKey = key; throw new Error('synthetic-timeout') })
    vi.mocked(deleteAllVersions).mockImplementation(async key => { objects.delete(key) })
    await runExportUserData(f.payload).catch(() => undefined)
    let row = await testDb.dataExportArtifact.findUniqueOrThrow({ where: { storageKey: lateKey } })
    expect(row).toMatchObject({ state: 'CLEANUP_REQUIRED', uploadOutcome: 'UNKNOWN' })
    expect(row.lastDeleteAt).not.toBeNull()
    objects.add(lateKey) // A remote completion after the client's rejected promise.
    await cleanupDataExport(row.id, f.student.userId)
    expect(objects.has(lateKey)).toBe(false)
    row = await testDb.dataExportArtifact.findUniqueOrThrow({ where: { id: row.id } })
    expect(row.state).toBe('CLEANUP_REQUIRED')
    expect(row.cleanedAt).toBeNull()
  })

  it('DELETE started before PUT acknowledgment cannot terminally clean using a later acknowledgment', async () => {
    const f = await fixture()
    const claim = (await claimDataExport(f.payload))!
    await beginDataExportUpload(claim)
    await invalidate(f.student.userId)
    const entered = deferred<void>()
    const release = deferred<void>()
    vi.mocked(deleteAllVersions).mockImplementationOnce(async () => { entered.resolve(); await release.promise })
    const cleaning = observe(cleanupDataExport(claim.id, f.student.userId))
    const pending: Promise<unknown>[] = [cleaning]
    try {
      await reachBarrier(entered.promise, cleaning, 'Cleanup DELETE')
      const acknowledging = observe(acknowledgeDataExportUpload(claim.id, f.student.userId))
      pending.push(acknowledging)
      await bounded(acknowledging, 'PUT acknowledgment during held DELETE')
    } finally { release.resolve(); await finishAll(pending, 'Cleanup DELETE completion') }
    expect((await testDb.dataExportArtifact.findUniqueOrThrow({ where: { id: claim.id } })).state).toBe('CLEANUP_REQUIRED')
    await cleanupDataExport(claim.id, f.student.userId)
    expect((await testDb.dataExportArtifact.findUniqueOrThrow({ where: { id: claim.id } })).state).toBe('CLEANED')
  })

  it.each(['RESERVED', 'UPLOADING', 'UPLOADED'] as const)('recovery discovers a seeded %s crash window after anonymization', async state => {
    const f = await fixture()
    const claim = (await claimDataExport(f.payload))!
    if (state !== 'RESERVED') await beginDataExportUpload(claim)
    if (state === 'UPLOADED') await acknowledgeDataExportUpload(claim.id, f.student.userId)
    // Seed a durable process-loss boundary; this is not an actual process-kill test.
    await testDb.user.update({ where: { id: f.student.userId }, data: { status: 'DELETED', email: `deleted-${randomUUID()}@purged.internal` } })
    await expire(f.request.id, claim.id)
    await recoverDataExports()
    const row = await testDb.dataExportArtifact.findUniqueOrThrow({ where: { id: claim.id } })
    expect(row.state).toBe(state === 'UPLOADING' ? 'CLEANUP_REQUIRED' : 'CLEANED')
    expect(sendBoss.send).not.toHaveBeenCalledWith('export-user-data', f.payload)
  })

  it('cleanup discovery survives hard deletion of User, Profile and DataRequest', async () => {
    const f = await fixture()
    const claim = (await claimDataExport(f.payload))!
    await beginDataExportUpload(claim)
    await testDb.user.delete({ where: { id: f.student.userId } })
    await testDb.dataExportArtifact.update({ where: { id: claim.id }, data: { leaseExpiresAt: new Date(0) } })
    await recoverDataExports()
    expect((await testDb.dataExportArtifact.findUniqueOrThrow({ where: { id: claim.id } })).state).toBe('CLEANUP_REQUIRED')
    expect(deleteAllVersions).toHaveBeenCalledWith(claim.storageKey)
  })

  it('an acknowledged cleanup failure remains discoverable and clears compatibility fields only after success', async () => {
    const f = await fixture()
    const claim = (await claimDataExport(f.payload))!
    await beginDataExportUpload(claim)
    await acknowledgeDataExportUpload(claim.id, f.student.userId)
    await invalidate(f.student.userId)
    vi.mocked(deleteAllVersions).mockRejectedValueOnce(new Error('synthetic-delete-secret'))
    await cleanupDataExport(claim.id, f.student.userId)
    expect(await testDb.dataRequest.findUniqueOrThrow({ where: { id: f.request.id } }))
      .toMatchObject({ status: 'REJECTED', resultKey: claim.storageKey, note: 'EXPORT_CLEANUP_REQUIRED' })
    await runExportUserData(f.payload)
    expect(await testDb.dataRequest.findUniqueOrThrow({ where: { id: f.request.id } }))
      .toMatchObject({ status: 'REJECTED', resultKey: null, note: null })
    expect(inspect(vi.mocked(logger.warn).mock.calls)).not.toContain('synthetic-delete-secret')
  })

  it('the first snapshot statement runs after a lifecycle writer releases its lock', async () => {
    const f = await fixture()
    const entered = deferred<void>()
    const release = deferred<void>()
    const writer = observe(testDb.$transaction(async tx => {
      await locks.lockXact(tx, locks.LOCK_NS.STUDENT_DATA, f.student.userId)
      await tx.studentProfile.update({ where: { id: f.student.profileId }, data: { headline: 'committed-same-snapshot' } })
      await tx.education.create({ data: { studentId: f.student.profileId, schoolName: 'committed-same-snapshot' } })
      entered.resolve(); await release.promise
    }, { timeout: 10_000 }))
    let claiming: ReturnType<typeof claimDataExport> | undefined
    try {
      await reachBarrier(entered.promise, writer, 'Lifecycle writer')
      const attemptedLock = deferred<void>()
      const original = locks.lockXact
      vi.spyOn(locks, 'lockXact').mockImplementation(async (tx, ns, id) => {
        if (ns === locks.LOCK_NS.STUDENT_DATA && id === f.student.userId) attemptedLock.resolve()
        return original(tx, ns, id)
      })
      claiming = observe(claimDataExport(f.payload))
      await reachBarrier(attemptedLock.promise, claiming, 'Export claim lifecycle lock')
      release.resolve(); await bounded(writer, 'Lifecycle writer completion')
      const claim = await bounded(claiming, 'Snapshot claim completion')
      expect(claim?.snapshot.files['profile.json']).toMatchObject({ headline: 'committed-same-snapshot' })
      expect(claim?.snapshot.files['educations.json']).toEqual(expect.arrayContaining([expect.objectContaining({ schoolName: 'committed-same-snapshot' })]))
    } finally {
      release.resolve()
      await finishAll(claiming ? [writer, claiming] : [writer], 'Snapshot test completion')
    }
  })

  it('preserves the existing export JSON files and binds every ledger key to exactly one application PUT', async () => {
    const f = await fixture()
    const profile = await testDb.studentProfile.update({ where: { id: f.student.profileId }, data: { cgpa: '3.00' } })
    const user = await testDb.user.findUniqueOrThrow({ where: { id: f.student.userId } })
    await runExportUserData(f.payload)
    const [key, bytes, type, options] = vi.mocked(putObject).mock.calls[0]!
    const files = unzipSync(bytes)
    for (const name of ['user.json', 'profile.json', 'educations.json', 'experiences.json', 'languages.json', 'applications.json', 'invitations.json', 'privacy.json', 'notifications.json']) {
      expect(files[name]).toBeDefined()
    }
    expect(JSON.parse(strFromU8(files['user.json']!))).toMatchObject({ id: f.student.userId })
    expect(JSON.parse(strFromU8(files['user.json']!)).createdAt).toBe(user.createdAt.toISOString())
    expect(JSON.parse(strFromU8(files['profile.json']!)).cgpa).toBe(profile.cgpa!.toJSON())
    const artifact = await testDb.dataExportArtifact.findUniqueOrThrow({ where: { storageKey: key } })
    expect(key).toBe(`exports/${f.student.userId}/${f.request.id}/${artifact.id}.zip`)
    expect(type).toBe('application/zip')
    expect(options).toMatchObject({ maxAttempts: 1, signal: expect.any(AbortSignal) })
    expect(putObject).toHaveBeenCalledTimes(1)
  })
})
