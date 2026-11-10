import { inspect } from 'node:util'
import { unzipSync, strFromU8 } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-queue-job'),
} }))
vi.mock('@/lib/storage', () => ({
  getObjectBytes: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 synthetic')),
  putObject: vi.fn().mockResolvedValue(undefined), deleteAllVersions: vi.fn().mockResolvedValue(undefined),
} ))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-test-key', AI_MODEL_PARSE: 'synthetic-test-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { bounded, finishAll, observe, reachBarrier } from '../helpers/data-export-barriers-t01'
import { readyT01Fixture, readyT01Resume, seedT01Student, T01_SUGGESTION, T01_VERSION } from '../helpers/resume-parsing-t01'
import { runExportUserData } from '@/server/jobs/export-user-data'
import { requestDeletion } from '@/server/services/data-rights'
import { discardResumeParseDraft, setResumeParseConsent } from '@/server/services/resume-parsing'
import { clearSettingsCache } from '@/server/services/settings'
import { deleteAllVersions, putObject } from '@/lib/storage'
import { sendNotificationEmail } from '@/server/services/notify'
import { logger } from '@/server/lib/logger'
import * as exportSnapshots from '@/server/services/data-export-snapshot'

setupTestDb()
beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache()
  vi.mocked(putObject).mockReset().mockResolvedValue(undefined)
  vi.mocked(deleteAllVersions).mockReset().mockResolvedValue(undefined)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

async function reachUpload(entered: Promise<string>, running: Promise<unknown>) {
  return reachBarrier(entered, running, 'Export upload')
}

async function whileUploadPaused(mutation: () => Promise<unknown>, release: () => void, running: Promise<unknown>) {
  const pending = observe(Promise.resolve().then(mutation))
  try {
    await bounded(pending, 'Lifecycle mutation during external upload')
  } finally {
    release()
    await finishAll([pending, running], 'Lifecycle mutation and export completion')
  }
}

async function exportRequest(userId: string) {
  return testDb.dataRequest.create({ data: { userId, type: 'EXPORT', status: 'OPEN' } })
}

function exportedJson() {
  const call = vi.mocked(putObject).mock.calls.at(-1)
  expect(call).toBeDefined()
  const files = unzipSync(new Uint8Array(call![1]))
  return Object.fromEntries(Object.entries(files).filter(([key]) => key.endsWith('.json'))
    .map(([key, bytes]) => [key, JSON.parse(strFromU8(bytes))]))
}

describe('M9-T01 owner export and deletion', () => {
  it('exports exact READY/CONFIRMED versions and the database snapshot time in the owner manifest', async () => {
    const f = await readyT01Fixture()
    const confirmed = await readyT01Resume(f.student)
    const other = await seedT01Student()
    const otherReady = await readyT01Resume(other)
    const readyTimes = {
      requestedAt: new Date('2026-10-01T01:02:03.004Z'), completedAt: new Date('2026-10-01T01:03:04.005Z'), confirmedAt: null,
    }
    const confirmedTimes = {
      requestedAt: new Date('2026-10-02T02:03:04.005Z'), completedAt: new Date('2026-10-02T02:04:05.006Z'),
      confirmedAt: new Date('2026-10-02T02:05:06.007Z'),
    }
    const readyVersions = {
      sourceSha256: 'a'.repeat(64), schemaVersion: 11, promptVersion: 'synthetic-prompt-ready',
      requestedModel: 'synthetic-request-ready', responseModel: 'synthetic-response-ready', appliedProfileRevision: null,
    }
    const confirmedVersions = {
      sourceSha256: 'b'.repeat(64), schemaVersion: 12, promptVersion: 'synthetic-prompt-confirmed',
      requestedModel: 'synthetic-request-confirmed', responseModel: 'synthetic-response-confirmed', appliedProfileRevision: 37,
    }
    await testDb.resumeParseDraft.update({ where: { resumeId: f.resume.id }, data: {
      ...readyVersions, ...readyTimes, leaseToken: 'private-lease-sentinel', confirmationHash: 'c'.repeat(64),
    } })
    // A contaminated legacy row must not export a second body for CONFIRMED.
    await testDb.resumeParseDraft.update({ where: { resumeId: confirmed.resume.id }, data: {
      ...confirmedVersions, ...confirmedTimes, state: 'CONFIRMED',
      payload: { ...T01_SUGGESTION, headline: 'confirmed-body-private-sentinel' },
    } })
    await testDb.resumeParseDraft.update({ where: { resumeId: otherReady.resume.id }, data: {
      payload: { ...T01_SUGGESTION, headline: 'other-owner-version-test-sentinel' },
      promptVersion: 'other-owner-prompt-sentinel',
    } })
    await testDb.systemSetting.update({ where: { key: 'ai.resumeParse' }, data: {
      value: { enabled: false, legalVersion: null, epoch: f.draft.gateEpoch },
    } })
    const readSnapshot = exportSnapshots.readDataExportSnapshot
    let databaseSnapshotAt: unknown
    const snapshotReader = vi.spyOn(exportSnapshots, 'readDataExportSnapshot').mockImplementation(async (tx, userId) => {
      const snapshot = await readSnapshot(tx, userId)
      if (snapshot) databaseSnapshotAt = Reflect.get(snapshot, 'snapshotAt')
      return snapshot
    })
    try {
      const req = await exportRequest(f.student.userId)
      await runExportUserData({ requestId: req.id, userId: f.student.userId })
      const json = exportedJson()
      expect(json['resume-parse-drafts.json']).toEqual([
        {
          resumeId: f.resume.id, generation: f.draft.generation, state: 'READY', payload: T01_SUGGESTION,
          failureCode: null, ...readyVersions,
          requestedAt: readyTimes.requestedAt.toISOString(), completedAt: readyTimes.completedAt.toISOString(), confirmedAt: null,
          source: { fileName: f.resume.fileName, createdAt: f.resume.createdAt.toISOString() },
        },
        {
          resumeId: confirmed.resume.id, generation: confirmed.draft.generation, state: 'CONFIRMED', payload: null,
          failureCode: null, ...confirmedVersions,
          requestedAt: confirmedTimes.requestedAt.toISOString(), completedAt: confirmedTimes.completedAt.toISOString(),
          confirmedAt: confirmedTimes.confirmedAt.toISOString(),
          source: { fileName: confirmed.resume.fileName, createdAt: confirmed.resume.createdAt.toISOString() },
        },
      ])
      expect(snapshotReader).toHaveBeenCalledOnce()
      expect(databaseSnapshotAt).toEqual(expect.any(String))
      expect(json['export-manifest.json']).toEqual({ snapshotAt: databaseSnapshotAt, skippedResumes: [] })
      expect(json['export-manifest.json'].snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(new Date(json['export-manifest.json'].snapshotAt).toISOString()).toBe(databaseSnapshotAt)
      const serialized = JSON.stringify(json)
      for (const value of [otherReady.resume.id, 'other-owner-version-test-sentinel', 'other-owner-prompt-sentinel',
        'confirmed-body-private-sentinel', 'private-lease-sentinel', f.resume.storageKey, confirmed.resume.storageKey,
        f.draft.consentGrantId, f.draft.gateEpoch, 'sourceStorageKey', 'leaseToken', 'confirmationHash',
        'rawPrompt', 'rawResponse', 'extractedText']) expect(serialized).not.toContain(value)
    } finally { snapshotReader.mockRestore() }
  })

  it.each(['QUEUED', 'PROCESSING', 'FAILED', 'CANCELLED'] as const)('never exports persisted %s payload', async state => {
    const f = await readyT01Fixture()
    await testDb.resumeParseDraft.update({ where: { resumeId: f.resume.id }, data: {
      state, payload: { ...T01_SUGGESTION, headline: 'non-ready-body-private-sentinel' },
    } })
    const req = await exportRequest(f.student.userId)
    await runExportUserData({ requestId: req.id, userId: f.student.userId })
    const json = exportedJson()
    expect(json['resume-parse-drafts.json']).toHaveLength(1)
    expect(json['resume-parse-drafts.json'][0]).toMatchObject({ resumeId: f.resume.id, state, payload: null })
    expect(JSON.stringify(json)).not.toContain('non-ready-body-private-sentinel')
    expect(JSON.stringify(json)).not.toContain(T01_SUGGESTION.summary)
  })

  it('exports only the owner READY suggestion and safe metadata with the gate off', async () => {
    const f = await readyT01Fixture()
    const other = await seedT01Student()
    const otherReady = await readyT01Resume(other)
    await testDb.resumeParseDraft.update({ where: { resumeId: otherReady.resume.id }, data: {
      payload: { ...T01_SUGGESTION, headline: 'other-owner-private-sentinel' },
    } })
    await testDb.systemSetting.update({ where: { key: 'ai.resumeParse' }, data: {
      value: { enabled: false, legalVersion: null, epoch: f.draft.gateEpoch },
    } })
    const req = await exportRequest(f.student.userId)
    await runExportUserData({ requestId: req.id, userId: f.student.userId })
    const json = exportedJson()
    expect(json['resume-parse-drafts.json']).toBeDefined()
    const drafts = JSON.stringify(json['resume-parse-drafts.json'])
    expect(drafts).toContain(f.resume.id)
    expect(drafts).toContain(T01_SUGGESTION.headline)
    for (const value of [otherReady.resume.id, 'other-owner-private-sentinel', f.resume.storageKey, f.draft.gateEpoch,
      f.draft.consentGrantId, 'leaseToken', 'sourceStorageKey', 'untouched-legacy']) {
      expect(drafts).not.toContain(value)
    }
    expect(JSON.stringify(json['privacy.json'])).toContain('AI_RESUME_PARSE')
    expect((await testDb.dataRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('DONE')
  })

  it.each(['discard', 'revoke'] as const)('%s removes draft content from later exports', async operation => {
    const f = await readyT01Fixture()
    if (operation === 'discard') await discardResumeParseDraft(f.ctx, { resumeId: f.resume.id, generation: f.draft.generation })
    else await setResumeParseConsent(f.ctx, { granted: false, submittedVersion: T01_VERSION })
    const req = await exportRequest(f.student.userId)
    await runExportUserData({ requestId: req.id, userId: f.student.userId })
    const json = JSON.stringify(exportedJson())
    expect(json).not.toContain(T01_SUGGESTION.headline)
    expect(json).not.toContain(T01_SUGGESTION.summary)
    expect((await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).payload).toBeNull()
  })

  it('soft deletion immediately cancels private drafts and prevents a queued export', async () => {
    const f = await readyT01Fixture()
    const req = await exportRequest(f.student.userId)
    await requestDeletion(f.ctx)
    const user = await testDb.user.findUniqueOrThrow({ where: { id: f.student.userId } })
    const draft = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
    expect(user.status).toBe('DELETED')
    expect(draft.state).toBe('CANCELLED')
    expect(draft.generation).toBe(f.draft.generation + 1)
    expect(draft.payload).toBeNull()
    await runExportUserData({ requestId: req.id, userId: f.student.userId })
    expect(putObject).not.toHaveBeenCalled()
    expect((await testDb.dataRequest.findUniqueOrThrow({ where: { id: req.id } })).status).not.toBe('DONE')
  })

  it.each(['delete', 'reject'] as const)('a %s committed during upload prevents publication and cleans the exact uploaded key', async invalidation => {
    const f = await readyT01Fixture()
    const req = await exportRequest(f.student.userId)
    const entered = deferred<string>()
    const release = deferred<void>()
    vi.mocked(putObject).mockImplementationOnce(async key => {
      entered.resolve(key)
      await release.promise
    })
    // Attach rejection handling immediately; the test must not leak an unhandled rejection.
    const running = observe(runExportUserData({ requestId: req.id, userId: f.student.userId }))
    try {
      const key = await reachUpload(entered.promise, running)
      await whileUploadPaused(async () => {
        if (invalidation === 'delete') await requestDeletion(f.ctx)
        else await testDb.dataRequest.update({ where: { id: req.id }, data: { status: 'REJECTED' } })
      }, () => release.resolve(), running)
      const result = await testDb.dataRequest.findUniqueOrThrow({ where: { id: req.id } })
      expect(result.status).not.toBe('DONE')
      expect(result.resultKey).toBeNull()
      expect(deleteAllVersions).toHaveBeenCalledWith(key)
      expect(vi.mocked(deleteAllVersions).mock.calls.every(call => call[0] === key)).toBe(true)
      expect(vi.mocked(sendNotificationEmail).mock.calls.some(call => call[1].template === 'data-export-ready')).toBe(false)
    } finally { release.resolve(); await finishAll([running], 'Invalidated export completion') }
  })

  it('retains cleanup work on a rejected request and retries after the user is anonymized', async () => {
    const f = await readyT01Fixture()
    const req = await exportRequest(f.student.userId)
    const entered = deferred<string>()
    const release = deferred<void>()
    vi.mocked(putObject).mockImplementationOnce(async key => { entered.resolve(key); await release.promise })
    vi.mocked(deleteAllVersions).mockRejectedValueOnce(new Error('synthetic-storage-secret@example.test'))
    const running = observe(runExportUserData({ requestId: req.id, userId: f.student.userId }))
    try {
      const key = await reachUpload(entered.promise, running)
      await whileUploadPaused(async () => {
        await requestDeletion(f.ctx)
        await testDb.user.update({ where: { id: f.student.userId }, data: {
          name: 'Deleted User synthetic', email: `deleted-${f.student.userId}@purged.internal`,
        } })
      }, () => release.resolve(), running)
      const failed = await testDb.dataRequest.findUniqueOrThrow({ where: { id: req.id } })
      expect(failed.status).toBe('REJECTED')
      expect(failed.note).toBe('EXPORT_CLEANUP_REQUIRED')
      expect(failed.resultKey).toBe(key)
      const failedArtifact = await testDb.dataExportArtifact.findUniqueOrThrow({ where: { storageKey: key } })
      expect(failedArtifact).toMatchObject({
        requestId: req.id, userId: f.student.userId, state: 'CLEANUP_REQUIRED', uploadOutcome: 'ACKNOWLEDGED', cleanedAt: null,
      })
      await runExportUserData({ requestId: req.id, userId: f.student.userId })
      const cleaned = await testDb.dataRequest.findUniqueOrThrow({ where: { id: req.id } })
      expect(cleaned.status).toBe('REJECTED')
      expect(cleaned.note).toBeNull()
      expect(cleaned.resultKey).toBeNull()
      const cleanedArtifact = await testDb.dataExportArtifact.findUniqueOrThrow({ where: { id: failedArtifact.id } })
      expect(cleanedArtifact).toMatchObject({ state: 'CLEANED', storageKey: key, uploadOutcome: 'ACKNOWLEDGED' })
      expect(cleanedArtifact.cleanedAt).not.toBeNull()
      expect(deleteAllVersions).toHaveBeenCalledTimes(2)
      expect(vi.mocked(deleteAllVersions).mock.calls.map(([deletedKey]) => deletedKey)).toEqual([key, key])
      expect(putObject).toHaveBeenCalledTimes(1)
      expect(inspect([vi.mocked(logger.error).mock.calls, vi.mocked(logger.warn).mock.calls], { depth: null }))
        .not.toContain('synthetic-storage-secret@example.test')
    } finally { release.resolve(); await finishAll([running], 'Anonymized export completion') }
  })
})
