import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/lib/storage', () => ({
  getObjectBytes: vi.fn(), putObject: vi.fn().mockResolvedValue(undefined),
  deleteAllVersions: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job'),
} }))
vi.mock('@/server/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import {
  claimDataExport, beginDataExportUpload, acknowledgeDataExportUpload, settleDataExport,
  reconcileExportRequest, recoverDataExports, cleanupDataExport,
} from '@/server/services/data-export-artifacts'
import { putObject, deleteAllVersions } from '@/lib/storage'
import { sendBoss } from '@/server/jobs/boss'

setupTestDb()
beforeEach(() => { vi.clearAllMocks(); vi.mocked(putObject).mockResolvedValue(undefined); vi.mocked(deleteAllVersions).mockResolvedValue(undefined) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function fixture() {
  const student = await createStudent(testDb)
  const request = await testDb.dataRequest.create({ data: { userId: student.userId, type: 'EXPORT' } })
  const payload = { userId: student.userId, requestId: request.id }
  const claim = await claimDataExport(payload)
  if (!claim) throw new Error('Expected a real export reservation')
  return { student, request, payload, claim }
}
async function dbNow() {
  const [clock] = await testDb.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`
  return clock!.now
}
async function prepare(state: 'RESERVED' | 'UPLOADING' | 'UPLOADED') {
  const f = await fixture()
  if (state !== 'RESERVED') {
    const began = await beginDataExportUpload(f.claim)
    if (!began) throw new Error('Expected a real upload reservation')
  }
  if (state === 'UPLOADED') {
    await putObject(f.claim.storageKey, Buffer.from('synthetic archive'), 'application/zip')
    await acknowledgeDataExportUpload(f.claim.id, f.student.userId)
  }
  return f
}
async function rows(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    request: await testDb.dataRequest.findUniqueOrThrow({ where: { id: f.request.id } }),
    artifact: await testDb.dataExportArtifact.findUniqueOrThrow({ where: { id: f.claim.id } }),
  }
}

// An additive fourth argument lets the original three-argument function execute
// these behavioral RED cases unchanged (it ignores the option), without a missing
// export/type error masking the unsafe transition. This calls the real service;
// it does not mock or replace settlement, DB, transactions, locks or query results.
async function recoverSelectedArtifact(f: Awaited<ReturnType<typeof fixture>>) {
  return Reflect.apply(settleDataExport, undefined, [f.claim.id, f.student.userId, false, { recoveryOnly: true }]) as Promise<string>
}

describe.each(['request-reconcile', 'periodic-recovery'] as const)('T01 database lease time: %s', entry => {
  it.each(['RESERVED', 'UPLOADING', 'UPLOADED'] as const)(
    'preserves a database-live %s generation when application Date is ahead', async state => {
      const f = await prepare(state)
      const before = await rows(f)
      const now = await dbNow()
      expect(before.request.exportLeaseExpiresAt!.getTime()).toBeGreaterThan(now.getTime())
      expect(before.artifact.leaseExpiresAt.getTime()).toBeGreaterThan(now.getTime())
      const putsBefore = vi.mocked(putObject).mock.calls.length
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        vi.setSystemTime(new Date(before.artifact.leaseExpiresAt.getTime() + 60_000))
        if (entry === 'request-reconcile') await reconcileExportRequest(f.payload)
        else await recoverDataExports()
        expect(before.artifact.leaseExpiresAt.getTime()).toBeGreaterThan((await dbNow()).getTime())
        expect(await rows(f)).toEqual(before)
        expect(deleteAllVersions).not.toHaveBeenCalled()
        expect(putObject).toHaveBeenCalledTimes(putsBefore)
        expect(sendBoss.send).not.toHaveBeenCalled()
      } finally { vi.useRealTimers() }
    }, 20_000,
  )

  it('discovers a database-expired reservation even when application Date is behind', async () => {
    const f = await fixture()
    const now = await dbNow()
    const expired = new Date(now.getTime() - 60_000)
    // Seed the durable crash boundary; PostgreSQL and its locks/queries remain real.
    await testDb.dataRequest.update({ where: { id: f.request.id }, data: { exportLeaseExpiresAt: expired } })
    await testDb.dataExportArtifact.update({ where: { id: f.claim.id }, data: { leaseExpiresAt: expired } })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(expired.getTime() - 60_000))
      if (entry === 'request-reconcile') await reconcileExportRequest(f.payload)
      else await recoverDataExports()
      const after = await rows(f)
      expect(after.artifact.state).toBe('CLEANED')
      expect(after.request).toMatchObject({ status: 'OPEN', exportLeaseToken: null, exportLeaseExpiresAt: null })
      expect(deleteAllVersions).toHaveBeenCalledWith(f.claim.storageKey)
      expect(putObject).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})

describe('T01 recovery revalidates under lifecycle locks', () => {
  it.each(['RESERVED', 'UPLOADING', 'UPLOADED'] as const)(
    'defers an already-selected current %s artifact while the database lease is valid', async state => {
      const f = await prepare(state)
      const before = await rows(f)
      const putsBefore = vi.mocked(putObject).mock.calls.length
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        vi.setSystemTime(new Date(before.artifact.leaseExpiresAt.getTime() + 60_000))
        expect(await recoverSelectedArtifact(f)).toBe('DEFERRED')
        expect(before.artifact.leaseExpiresAt.getTime()).toBeGreaterThan((await dbNow()).getTime())
        expect(await rows(f)).toEqual(before)
        expect(deleteAllVersions).not.toHaveBeenCalled()
        expect(putObject).toHaveBeenCalledTimes(putsBefore)
      } finally { vi.useRealTimers() }
    },
  )

  it.each(['RESERVED', 'UPLOADING', 'UPLOADED'] as const)(
    'keeps explicit worker abandonment available for its still-live %s attempt', async state => {
      const f = await prepare(state)
      const before = await rows(f)
      expect(before.artifact.leaseExpiresAt.getTime()).toBeGreaterThan((await dbNow()).getTime())
      expect(await settleDataExport(f.claim.id, f.student.userId, false)).toBe('CLEANUP_REQUIRED')
      await cleanupDataExport(f.claim.id, f.student.userId)
      const after = await rows(f)
      expect(after.request).toMatchObject({ status: 'OPEN', exportLeaseToken: null, exportLeaseExpiresAt: null })
      expect(after.artifact.state).toBe(state === 'UPLOADING' ? 'CLEANUP_REQUIRED' : 'CLEANED')
      expect(deleteAllVersions).toHaveBeenCalledWith(f.claim.storageKey)
    },
  )

  it.each(['request-generation', 'request-token', 'request-expiry', 'artifact-expiry', 'request-rejected', 'inactive-owner'] as const)(
    'does not defer a selected artifact after %s invalidates its current lease', async invalidation => {
      const f = await prepare('UPLOADING')
      const past = new Date((await dbNow()).getTime() - 60_000)
      if (invalidation === 'request-generation') await testDb.dataRequest.update({ where: { id: f.request.id }, data: { exportGeneration: { increment: 1 } } })
      if (invalidation === 'request-token') await testDb.dataRequest.update({ where: { id: f.request.id }, data: { exportLeaseToken: 'synthetic-new-owner-token' } })
      if (invalidation === 'request-expiry') await testDb.dataRequest.update({ where: { id: f.request.id }, data: { exportLeaseExpiresAt: past } })
      if (invalidation === 'artifact-expiry') await testDb.dataExportArtifact.update({ where: { id: f.claim.id }, data: { leaseExpiresAt: past } })
      if (invalidation === 'request-rejected') await testDb.dataRequest.update({ where: { id: f.request.id }, data: { status: 'REJECTED' } })
      if (invalidation === 'inactive-owner') await testDb.user.update({ where: { id: f.student.userId }, data: { status: 'DELETED' } })
      expect(await recoverSelectedArtifact(f)).toBe('CLEANUP_REQUIRED')
      expect((await rows(f)).artifact).toMatchObject({ state: 'CLEANUP_REQUIRED', uploadOutcome: 'UNKNOWN' })
    },
  )
})
