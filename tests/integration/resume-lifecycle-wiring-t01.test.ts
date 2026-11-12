import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ send: vi.fn(), remove: vi.fn(), s3: vi.fn() }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: io.send } }))
vi.mock('@/lib/storage', () => ({ deleteAllVersions: io.remove, getObjectBytes: vi.fn(), putObject: vi.fn() }))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn() }))
vi.mock('@/server/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/server/action', () => ({ action: (_options: unknown, handler: unknown) => handler }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = io.s3 },
  ListObjectVersionsCommand: class { constructor(public input: unknown) {} },
  DeleteObjectsCommand: class { constructor(public input: unknown) {} },
}))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-key', AI_MODEL_PARSE: 'synthetic-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { readyT01Fixture } from '../helpers/resume-parsing-t01'
import { deleteResume, setPrimaryResume } from '@/server/actions/resume'
import { requestExport, requestDeletion, getExportDownloadRequest } from '@/server/services/data-rights'
import { recordConsents } from '@/server/services/consent'
import { cleanupLegacyDataExports, runPurgeDeletedAccounts } from '@/server/jobs/purge-deleted-accounts'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(() => {
  vi.clearAllMocks(); clearSettingsCache()
  io.send.mockReset().mockResolvedValue('synthetic-job'); io.remove.mockReset().mockResolvedValue(undefined)
  io.s3.mockReset().mockResolvedValue({ Versions: [], DeleteMarkers: [], IsTruncated: false })
})
const callResume = (fn: typeof deleteResume, userId: string, resumeId: string) =>
  (fn as unknown as (ctx: { userId: string; input: { resumeId: string } }) => Promise<{ ok: true }>)({ userId, input: { resumeId } })
async function published(userId: string) {
  const now = new Date(), id = randomUUID(), token = randomUUID()
  const request = await testDb.dataRequest.create({ data: { userId, type: 'EXPORT', status: 'DONE', resolvedAt: now, exportGeneration: 1 } })
  const storageKey = `exports/${userId}/${request.id}/${id}.zip`
  const artifact = await testDb.dataExportArtifact.create({ data: {
    id, requestId: request.id, userId, generation: 1, leaseToken: token,
    leaseExpiresAt: new Date(now.getTime() + 300_000), storageKey, state: 'PUBLISHED', uploadOutcome: 'ACKNOWLEDGED',
    publishedAt: now, expiresAt: new Date(now.getTime() + 86_400_000),
  } })
  return { request: await testDb.dataRequest.update({ where: { id: request.id }, data: { resultKey: storageKey } }), artifact }
}
async function legacy(userId: string, createdAt = new Date('2026-01-01T00:00:00Z')) {
  const request = await testDb.dataRequest.create({ data: { userId, type: 'EXPORT', status: 'DONE', createdAt, resolvedAt: new Date() } })
  return testDb.dataRequest.update({ where: { id: request.id }, data: { resultKey: `exports/${userId}/${request.id}.zip` } })
}

describe('T01 lifecycle integration candidates', () => {
  it('deduplicates concurrent export requests under locks and keeps failed queue intent OPEN', async () => {
    const student = await createStudent(testDb)
    io.send.mockRejectedValueOnce(new Error('PRIVATE_QUEUE_RESPONSE'))
    const results = await Promise.all([requestExport(student), requestExport(student)])
    expect(new Set(results.map(row => row.requestId)).size).toBe(1)
    expect(results.filter(row => !row.existing)).toHaveLength(1)
    expect((await testDb.dataRequest.findUniqueOrThrow({ where: { id: results[0].requestId } })).status).toBe('OPEN')
  })
  it.each(['SUSPENDED', 'DELETED'] as const)('refuses a new export for current %s status', async status => {
    const student = await createStudent(testDb)
    await testDb.user.update({ where: { id: student.userId }, data: { status } })
    await expect(requestExport(student)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await testDb.dataRequest.count()).toBe(0); expect(io.send).not.toHaveBeenCalled()
  })
  it('never reuses or downloads a legacy DONE key without a PUBLISHED artifact', async () => {
    const student = await createStudent(testDb), old = await legacy(student.userId)
    expect(await getExportDownloadRequest(student, old.id)).toBeNull()
    expect((await requestExport(student)).requestId).not.toBe(old.id)
    expect((await testDb.dataRequest.findUniqueOrThrow({ where: { id: old.id } })).resultKey).toBe(old.resultKey)
  })
  it('returns the existing narrow download DTO only for the active exact published winner', async () => {
    const student = await createStudent(testDb), current = await published(student.userId)
    const dto = await getExportDownloadRequest(student, current.request.id)
    expect(Object.keys(dto!).sort()).toEqual(['id', 'resolvedAt', 'resultKey', 'status', 'type', 'userId'])
    expect(await requestExport(student)).toEqual({ requestId: current.request.id, existing: true })
    await testDb.dataExportArtifact.update({ where: { id: current.artifact.id }, data: { state: 'CLEANUP_REQUIRED', cleanupNextAt: new Date() } })
    expect(await getExportDownloadRequest(student, current.request.id)).toBeNull()
  })
  it('soft deletion atomically cancels drafts and marks artifacts for independent cleanup', async () => {
    const fixture = await readyT01Fixture(), current = await published(fixture.student.userId), old = await legacy(fixture.student.userId)
    await requestDeletion(fixture.ctx)
    expect(await testDb.resumeParseDraft.findUnique({ where: { resumeId: fixture.resume.id } })).toMatchObject({ state: 'CANCELLED', payload: null, generation: fixture.draft.generation + 1 })
    expect(await testDb.dataExportArtifact.findUnique({ where: { id: current.artifact.id } })).toMatchObject({ state: 'CLEANUP_REQUIRED' })
    expect(await testDb.dataRequest.findUnique({ where: { id: old.id } })).toMatchObject({ status: 'REJECTED', resultKey: old.resultKey })
    expect(await getExportDownloadRequest(fixture.ctx, current.request.id)).toBeNull()
    expect(io.remove).not.toHaveBeenCalled()
  })
  it('repeated deletion repairs invalidation without moving the retention date or duplicating DELETE requests', async () => {
    const fixture = await readyT01Fixture(), date = new Date('2026-01-01T00:00:00Z')
    await testDb.user.update({ where: { id: fixture.student.userId }, data: { status: 'DELETED', deletedAt: date } })
    await requestDeletion(fixture.ctx)
    expect((await testDb.user.findUniqueOrThrow({ where: { id: fixture.student.userId } })).deletedAt).toEqual(date)
    expect((await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: fixture.resume.id } })).state).toBe('CANCELLED')
    expect(await testDb.dataRequest.count({ where: { type: 'DELETE' } })).toBe(0)
  })
  it('resume deletion cascades its private draft before storage and never resurrects it on storage failure', async () => {
    const fixture = await readyT01Fixture()
    io.remove.mockImplementationOnce(async () => {
      expect(await testDb.resumeFile.findUnique({ where: { id: fixture.resume.id } })).toBeNull()
      expect(await testDb.resumeParseDraft.findUnique({ where: { resumeId: fixture.resume.id } })).toBeNull()
      throw new Error('synthetic-storage-failure')
    })
    await expect(callResume(deleteResume, fixture.student.userId, fixture.resume.id)).rejects.toThrow('synthetic-storage-failure')
    expect(await testDb.resumeFile.findUnique({ where: { id: fixture.resume.id } })).toBeNull()
    expect(io.remove).toHaveBeenCalledExactlyOnceWith(fixture.resume.storageKey)
  })
  it.each([deleteResume, setPrimaryResume])('rejects a stale authenticated resume operation for a DELETED user', async action => {
    const fixture = await readyT01Fixture()
    await testDb.user.update({ where: { id: fixture.student.userId }, data: { status: 'DELETED', deletedAt: new Date() } })
    await expect(callResume(action, fixture.student.userId, fixture.resume.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await testDb.resumeFile.findUnique({ where: { id: fixture.resume.id } })).not.toBeNull()
    expect(io.remove).not.toHaveBeenCalled()
  })
  it.each(['AI_RESUME_PARSE', 'AI_MATCHING'] as const)('rejects mixed generic %s batches before any consent writes', async type => {
    const student = await createStudent(testDb)
    // AI_MATCHING is reserved for T03; unknown runtime types must also be rejected.
    await expect(Reflect.apply(recordConsents, undefined, [student.userId,
      [{ type: 'TERMS', granted: true }, { type, granted: true }], {},
    ])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(await testDb.consent.count({ where: { userId: student.userId } })).toBe(0)
  })
  it('legacy cleanup remains discoverable after anonymization and preserves failed exact-key work', async () => {
    const student = await createStudent(testDb), old = await legacy(student.userId)
    await testDb.user.update({ where: { id: student.userId }, data: { status: 'DELETED', email: `deleted-${student.userId}@purged.internal` } })
    io.remove.mockRejectedValueOnce(new Error('PRIVATE_STORAGE_RESPONSE'))
    const options = { cutoverAt: new Date('2026-01-02T00:00:00Z'), oldWritersQuiesced: true as const }
    expect(await cleanupLegacyDataExports(options)).toEqual({ cleaned: 0, pending: 1 })
    expect((await testDb.dataRequest.findUniqueOrThrow({ where: { id: old.id } })).resultKey).toBe(old.resultKey)
    expect(await cleanupLegacyDataExports(options)).toEqual({ cleaned: 1, pending: 0 })
    expect((await testDb.dataRequest.findUniqueOrThrow({ where: { id: old.id } })).resultKey).toBeNull()
    expect(io.remove.mock.calls.map(row => row[0])).toEqual([old.resultKey, old.resultKey])
  })
  it('legacy sweep never touches a post-cutover fixed key or an artifact winner', async () => {
    const student = await createStudent(testDb), current = await published(student.userId)
    await legacy(student.userId, new Date('2026-01-03T00:00:00Z'))
    expect(await cleanupLegacyDataExports({ cutoverAt: new Date('2026-01-02T00:00:00Z'), oldWritersQuiesced: true })).toEqual({ cleaned: 0, pending: 0 })
    expect(io.remove).not.toHaveBeenCalled()
    expect((await testDb.dataExportArtifact.findUniqueOrThrow({ where: { id: current.artifact.id } })).state).toBe('PUBLISHED')
  })
  it('requires explicit old-writer quiescence before any legacy cleanup', async () => {
    await expect(cleanupLegacyDataExports({ cutoverAt: new Date('2026-01-02T00:00:00Z'), oldWritersQuiesced: false } as unknown as Parameters<typeof cleanupLegacyDataExports>[0])).rejects.toThrow('LEGACY_EXPORT_CUTOVER_REQUIRED')
    expect(io.remove).not.toHaveBeenCalled()
  })
  it('rechecks current account status after external purge I/O before anonymization', async () => {
    const fixture = await readyT01Fixture()
    await testDb.user.update({ where: { id: fixture.student.userId }, data: { status: 'DELETED', deletedAt: new Date('2026-01-01T00:00:00Z') } })
    io.s3.mockImplementationOnce(async () => {
      await testDb.user.update({ where: { id: fixture.student.userId }, data: { status: 'ACTIVE' } })
      return { Versions: [], DeleteMarkers: [], IsTruncated: false }
    })
    expect(await runPurgeDeletedAccounts()).toEqual({ purged: 0 })
    expect((await testDb.user.findUniqueOrThrow({ where: { id: fixture.student.userId } })).email).not.toContain('@purged.internal')
    expect(await testDb.resumeFile.findUnique({ where: { id: fixture.resume.id } })).not.toBeNull()
  })
  it('does not anonymize after a partial S3 prefix-delete failure', async () => {
    const fixture = await readyT01Fixture()
    await testDb.user.update({ where: { id: fixture.student.userId }, data: { status: 'DELETED', deletedAt: new Date('2026-01-01T00:00:00Z') } })
    io.s3.mockResolvedValueOnce({ Versions: [{ Key: `exports/${fixture.student.userId}/legacy.zip`, VersionId: 'one' }], IsTruncated: false })
      .mockResolvedValueOnce({ Errors: [{ Code: 'AccessDenied' }] })
    await expect(runPurgeDeletedAccounts()).rejects.toThrow('ACCOUNT_PURGE_STORAGE_PENDING')
    expect((await testDb.user.findUniqueOrThrow({ where: { id: fixture.student.userId } })).email).not.toContain('@purged.internal')
    expect(await testDb.resumeFile.findUnique({ where: { id: fixture.resume.id } })).not.toBeNull()
  })
})
