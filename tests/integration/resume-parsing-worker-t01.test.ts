import { createHash, randomUUID } from 'node:crypto'
import { inspect } from 'node:util'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job'),
} }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: vi.fn(), deleteAllVersions: vi.fn() }))
vi.mock('@/server/lib/resume-text', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/lib/resume-text')>(),
  extractResumeText: vi.fn(),
}))
vi.mock('@/server/lib/ai/resume-provider', () => ({ generateResumeSuggestion: vi.fn() }))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/lib/logger', () => ({ logger: {
  fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
} }))
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-key', AI_MODEL_PARSE: 'synthetic-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin } from '../factories'
import { getSession } from '@/server/auth'
import { deleteResume } from '@/server/actions/resume'
import { runResumeParse } from '@/server/jobs/parse-resume'
import { sendBoss } from '@/server/jobs/boss'
import { getObjectBytes, deleteAllVersions } from '@/lib/storage'
import { extractResumeText } from '@/server/lib/resume-text'
import { generateResumeSuggestion } from '@/server/lib/ai/resume-provider'
import type { ResumeProviderResult } from '@/server/lib/ai/resume-provider'
import { requestResumeParse, setResumeParseConsent } from '@/server/services/resume-parsing'
import { requestDeletion } from '@/server/services/data-rights'
import { updateResumeParseSettingsAdmin } from '@/server/services/admin-settings'
import { clearSettingsCache, getSetting } from '@/server/services/settings'
import { logger } from '@/server/lib/logger'
import * as Sentry from '@sentry/node'
import {
  seedT01Gate, seedT01Resume, seedT01Student, snapshotT01Profile,
  T01_BYTES, T01_HASH, T01_SUGGESTION, T01_VERSION,
} from '../helpers/resume-parsing-t01'

setupTestDb()

const INPUT = 'Synthetic TypeScript career evidence. private-input@example.test +60123456789'
const RAW_ERROR = 'PRIVATE_SDK_ERROR_BODY_SENTINEL'
const FAILURE_CODES = new Set([
  'QUEUE_UNAVAILABLE', 'SOURCE_MISSING', 'SOURCE_CHANGED', 'PDF_INVALID', 'PDF_ENCRYPTED',
  'PDF_TOO_MANY_PAGES', 'PDF_NO_TEXT', 'PDF_LIMIT', 'EXTRACTION_TIMEOUT', 'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE', 'PROVIDER_REFUSAL', 'OUTPUT_TRUNCATED', 'OUTPUT_INVALID',
  'AUTHORIZATION_CHANGED', 'ATTEMPTS_EXHAUSTED',
])
const success = (headline = T01_SUGGESTION.headline): ResumeProviderResult => ({
  ok: true, output: { ...T01_SUGGESTION, headline }, responseModel: 'synthetic-response-model',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic boundary not reached')), 5_000) }),
    ])
  } finally { clearTimeout(timer) }
}

// Attach a rejection handler immediately; finally still awaits and asserts the result.
function start(f: Fixture, signal?: AbortSignal) {
  return runResumeParse({ resumeId: f.resume.id, generation: f.draft.generation }, { signal })
    .then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
}

async function finish(work: ReturnType<typeof start>) {
  const result = await bounded(work)
  if (!result.ok) throw result.error
}

async function queuedFixture() {
  await seedT01Gate()
  const student = await seedT01Student()
  const resume = await seedT01Resume(student)
  await requestResumeParse({ userId: student.userId }, { resumeId: resume.id })
  const draft = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: resume.id } })
  const profile = await snapshotT01Profile(student.profileId)
  return { student, resume, draft, profile, ctx: { userId: student.userId } }
}
type Fixture = Awaited<ReturnType<typeof queuedFixture>>

async function asStudent(userId: string) {
  const user = await testDb.user.findUniqueOrThrow({ where: { id: userId } })
  const now = new Date()
  vi.mocked(getSession).mockResolvedValue({ user: user as never, session: {
    id: 'synthetic-session', userId, token: 'synthetic-token', expiresAt: new Date(Date.now() + 86_400_000),
    ipAddress: null, userAgent: null, createdAt: now, updatedAt: now,
  } })
}

async function noReady(f: Fixture) {
  const draft = await testDb.resumeParseDraft.findUnique({ where: { resumeId: f.resume.id } })
  if (draft) {
    expect(draft.state).not.toBe('READY')
    expect(draft.payload).toBeNull()
    if (draft.failureCode !== null) expect(FAILURE_CODES.has(draft.failureCode)).toBe(true)
  }
}

async function unchanged(f: Fixture) {
  expect(await snapshotT01Profile(f.student.profileId)).toEqual(f.profile)
  const resume = await testDb.resumeFile.findUnique({ where: { id: f.resume.id } })
  if (resume) expect(resume.parsedJson).toEqual(f.resume.parsedJson)
}

async function noRaw(secrets = [INPUT, RAW_ERROR]) {
  const observed = inspect({
    logs: [logger.fatal, logger.error, logger.warn, logger.info, logger.debug, logger.trace].map(fn => vi.mocked(fn).mock.calls),
    sentry: [vi.mocked(Sentry.captureException).mock.calls, vi.mocked(Sentry.captureMessage).mock.calls],
    drafts: await testDb.resumeParseDraft.findMany(), audits: await testDb.auditLog.findMany(),
  }, { depth: 20, maxStringLength: Infinity, maxArrayLength: Infinity })
  for (const secret of secrets) expect(observed).not.toContain(secret)
}

async function heldAt(stage: 'extract' | 'provider', f: Fixture, change: () => Promise<void>) {
  const entered = deferred<void>()
  const release = deferred<void>()
  if (stage === 'extract') vi.mocked(extractResumeText).mockImplementationOnce(async () => {
    entered.resolve(); await release.promise
    return { ok: true, text: INPUT, pageCount: 1 }
  })
  else vi.mocked(generateResumeSuggestion).mockImplementationOnce(async () => {
    entered.resolve(); await release.promise
    return success()
  })
  const work = start(f)
  let mutation: Promise<void> | undefined
  try {
    await bounded(entered.promise)
    mutation = change()
    await bounded(mutation)
  } finally {
    release.resolve()
    const results = await Promise.allSettled([finish(work), ...(mutation ? [bounded(mutation)] : [])])
    for (const result of results) if (result.status === 'rejected') throw result.reason
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache()
  vi.mocked(getObjectBytes).mockReset().mockResolvedValue(T01_BYTES)
  vi.mocked(deleteAllVersions).mockReset().mockResolvedValue(undefined)
  vi.mocked(extractResumeText).mockReset().mockResolvedValue({ ok: true, text: INPUT, pageCount: 1 })
  vi.mocked(generateResumeSuggestion).mockReset().mockResolvedValue(success())
  vi.mocked(sendBoss.send).mockReset().mockResolvedValue('synthetic-job')
})

describe('M9-T01 worker authorization and source', () => {
  it('W1 publishes only a private draft and passes only minimized text and frozen versions', async () => {
    const f = await queuedFixture()
    await finish(start(f))
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toMatchObject({
      state: 'READY', generation: f.draft.generation, attempts: 1, payload: T01_SUGGESTION,
      leaseToken: null, leaseExpiresAt: null, failureCode: null, responseModel: 'synthetic-response-model',
    })
    await unchanged(f)
    expect(getObjectBytes).toHaveBeenCalledExactlyOnceWith(f.resume.storageKey, {
      maxBytes: 5 * 1024 * 1024, signal: expect.any(AbortSignal),
    })
    expect(extractResumeText).toHaveBeenCalledExactlyOnceWith(T01_BYTES, {
      maxPages: 20, signal: expect.any(AbortSignal),
    })
    expect(generateResumeSuggestion).toHaveBeenCalledOnce()
    const [input, options] = vi.mocked(generateResumeSuggestion).mock.calls[0]
    expect(Object.keys(input).sort()).toEqual(['model', 'promptVersion', 'schemaVersion', 'text'])
    expect(input).toMatchObject({ model: f.draft.requestedModel, promptVersion: f.draft.promptVersion, schemaVersion: 1 })
    expect(input.text).toContain('Synthetic TypeScript career evidence')
    for (const secret of ['private-input@example.test', '+60123456789', f.resume.fileName, f.resume.storageKey, f.student.userId, f.profile.summary!]) {
      expect(JSON.stringify(input)).not.toContain(secret)
    }
    expect(options.signal).toBeInstanceOf(AbortSignal)
    const messages = vi.mocked(sendBoss.send).mock.calls.filter(call => call[0] === 'resume-parse')
    expect(messages.length).toBeGreaterThan(0)
    for (const call of messages) expect(call[1]).toEqual({ resumeId: f.resume.id, generation: f.draft.generation })
    await noRaw()
  })

  it.each(['consent', 'legal-version', 'deleted', 'source-key', 'gate-disabled', 'gate-invalid'] as const)(
    'W2 rejects %s before external work, including a warmed stale settings cache', async change => {
      const f = await queuedFixture()
      await getSetting('ai.resumeParse', null)
      await getSetting('legal.currentVersion', null)
      if (change === 'consent') await testDb.consent.deleteMany({ where: { userId: f.student.userId, type: 'AI_RESUME_PARSE' } })
      if (change === 'legal-version') await testDb.systemSetting.update({ where: { key: 'legal.currentVersion' }, data: { value: 'new-synthetic-policy' } })
      if (change === 'deleted') await testDb.user.update({ where: { id: f.student.userId }, data: { status: 'DELETED' } })
      if (change === 'source-key') await testDb.resumeFile.update({ where: { id: f.resume.id }, data: { storageKey: 'resumes/synthetic/replaced.pdf' } })
      if (change.startsWith('gate-')) await testDb.systemSetting.update({ where: { key: 'ai.resumeParse' }, data: {
        value: change === 'gate-disabled' ? { enabled: false, legalVersion: T01_VERSION, epoch: randomUUID() } : { enabled: true },
      } })
      await finish(start(f))
      expect(getObjectBytes).not.toHaveBeenCalled()
      expect(extractResumeText).not.toHaveBeenCalled()
      expect(generateResumeSuggestion).not.toHaveBeenCalled()
      await noReady(f)
      await unchanged(f)
    },
  )

  it.each(['revoke', 'delete-resume', 'delete-account'] as const)('W3 %s during extraction prevents provider submission', async operation => {
    const f = await queuedFixture()
    await asStudent(f.student.userId)
    let afterChange = f.profile
    await heldAt('extract', f, async () => {
      if (operation === 'revoke') await setResumeParseConsent(f.ctx, { granted: false, submittedVersion: T01_VERSION })
      if (operation === 'delete-resume') await deleteResume({ resumeId: f.resume.id })
      if (operation === 'delete-account') await requestDeletion(f.ctx)
      afterChange = await snapshotT01Profile(f.student.profileId)
    })
    expect(generateResumeSuggestion).not.toHaveBeenCalled()
    await noReady(f)
    expect(await snapshotT01Profile(f.student.profileId)).toEqual(afterChange)
    const expectedRemaining = operation === 'delete-resume' ? 0 : 1
    expect(await testDb.resumeFile.count({ where: { id: f.resume.id } })).toBe(expectedRemaining)
    expect(await testDb.resumeParseDraft.count({ where: { resumeId: f.resume.id } })).toBe(expectedRemaining)
    const invalidated = await testDb.resumeParseDraft.findUnique({ where: { resumeId: f.resume.id } })
    expect(invalidated?.state ?? 'DELETED').toBe(operation === 'delete-resume' ? 'DELETED' : 'CANCELLED')
    expect(invalidated?.generation ?? f.draft.generation + 1).toBeGreaterThan(f.draft.generation)
  })

  it.each(['regrant', 'reenable'] as const)('W4 %s cannot authorize an old in-flight response', async operation => {
    const f = await queuedFixture()
    const admin = await createAdmin(testDb)
    await heldAt('provider', f, async () => {
      if (operation === 'regrant') {
        await setResumeParseConsent(f.ctx, { granted: false, submittedVersion: T01_VERSION })
        await setResumeParseConsent(f.ctx, { granted: true, submittedVersion: T01_VERSION })
      } else {
        await updateResumeParseSettingsAdmin({ userId: admin.userId }, { enabled: false, legalVersion: T01_VERSION })
        await updateResumeParseSettingsAdmin({ userId: admin.userId }, { enabled: true, legalVersion: T01_VERSION })
      }
    })
    const latest = await testDb.consent.findFirstOrThrow({
      where: { userId: f.student.userId, type: 'AI_RESUME_PARSE' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    const gate = await getSetting<{ epoch: string } | null>('ai.resumeParse', null, { fresh: true })
    expect(latest.id !== f.draft.consentGrantId).toBe(operation === 'regrant')
    expect(gate?.epoch !== f.draft.gateEpoch).toBe(operation === 'reenable')
    expect(generateResumeSuggestion).toHaveBeenCalledOnce()
    await noReady(f)
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toMatchObject({
      state: 'CANCELLED', payload: null, leaseToken: null, leaseExpiresAt: null,
    })
    await unchanged(f)
  })

  it.each([false, true])('W5 deleting the source during provider work never resurrects it (S3 failure=%s)', async failDelete => {
    const f = await queuedFixture()
    await asStudent(f.student.userId)
    if (failDelete) vi.mocked(deleteAllVersions).mockRejectedValueOnce(new Error('synthetic-object-delete-unavailable'))
    let profileAfterDelete: Fixture['profile'] | undefined
    await heldAt('provider', f, async () => {
      const beforeDelete = await snapshotT01Profile(f.student.profileId)
      expect(beforeDelete).toEqual(f.profile)
      const deletionStartedAt = Date.now()
      await deleteResume({ resumeId: f.resume.id })
      const deletionFinishedAt = Date.now()
      profileAfterDelete = await snapshotT01Profile(f.student.profileId)
      // This fixture has work authorization (30) and existing ability text (20).
      // Compare every other field and relation; updatedAt is Prisma-maintained.
      expect(profileAfterDelete).toEqual({ ...beforeDelete, completeness: 50,
        editRevision: beforeDelete.editRevision + 1, updatedAt: profileAfterDelete.updatedAt })
      expect(profileAfterDelete.updatedAt.getTime()).toBeGreaterThanOrEqual(deletionStartedAt)
      expect(profileAfterDelete.updatedAt.getTime()).toBeLessThanOrEqual(deletionFinishedAt)
      expect(await testDb.resumeFile.findUnique({ where: { id: f.resume.id } })).toBeNull()
      expect(await testDb.resumeParseDraft.findUnique({ where: { resumeId: f.resume.id } })).toBeNull()
    })
    expect(deleteAllVersions).toHaveBeenCalledExactlyOnceWith(f.resume.storageKey)
    expect(await testDb.resumeFile.findUnique({ where: { id: f.resume.id } })).toBeNull()
    expect(await testDb.resumeParseDraft.findUnique({ where: { resumeId: f.resume.id } })).toBeNull()
    expect(generateResumeSuggestion).toHaveBeenCalledOnce()
    expect(await snapshotT01Profile(f.student.profileId)).toEqual(profileAfterDelete)
  })

  it.each(['bytes', 'current-file-hash'] as const)('W6 compares the read bytes against both hashes (%s mismatch)', async source => {
    const f = await queuedFixture()
    if (source === 'bytes') vi.mocked(getObjectBytes).mockResolvedValueOnce(Buffer.from('different synthetic content'))
    else await testDb.resumeFile.update({ where: { id: f.resume.id }, data: {
      contentSha256: createHash('sha256').update('other-source').digest('hex'),
    } })
    await finish(start(f))
    expect(extractResumeText).not.toHaveBeenCalled()
    expect(generateResumeSuggestion).not.toHaveBeenCalled()
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toMatchObject({
      state: 'FAILED', failureCode: 'SOURCE_CHANGED', payload: null, sourceSha256: T01_HASH,
    })
  })
})

describe('M9-T01 token fencing and bounded failure', () => {
  it('W7 a duplicate delivery cannot claim a currently leased generation', async () => {
    const f = await queuedFixture()
    await heldAt('provider', f, async () => {
      const claimed = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
      expect(claimed).toMatchObject({ state: 'PROCESSING', attempts: 1 })
      expect(claimed.leaseToken).toBeTruthy()
      await bounded(finish(start(f)))
      expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toEqual(claimed)
      expect(generateResumeSuggestion).toHaveBeenCalledOnce()
    })
    expect(generateResumeSuggestion).toHaveBeenCalledOnce()
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toMatchObject({ state: 'READY', attempts: 1 })
    await unchanged(f)
  })

  it.each(['success', 'failure'] as const)('W8 expired-token late %s cannot overwrite a newer completion', async late => {
    const f = await queuedFixture()
    const entered = deferred<void>()
    const release = deferred<void>()
    vi.mocked(generateResumeSuggestion).mockImplementationOnce(async () => {
      entered.resolve(); await release.promise
      return late === 'success' ? success('OLD_RESULT_SENTINEL') : { ok: false, reason: 'unavailable' }
    }).mockResolvedValue(success('New valid result'))
    const oldWork = start(f)
    let winner: typeof f.draft | undefined
    let auditCount = 0
    try {
      await bounded(entered.promise)
      const oldClaim = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
      await testDb.resumeParseDraft.update({ where: { resumeId: f.resume.id }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } })
      await finish(start(f))
      winner = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
      expect(winner).toMatchObject({ state: 'READY', attempts: 2, payload: { headline: 'New valid result' }, leaseToken: null })
      expect(oldClaim.leaseToken).toBeTruthy()
      auditCount = await testDb.auditLog.count()
    } finally { release.resolve(); await finish(oldWork) }
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toEqual(winner)
    expect(await testDb.auditLog.count()).toBe(auditCount)
    expect(generateResumeSuggestion).toHaveBeenCalledTimes(2)
    await unchanged(f)
  })

  it.each(['success', 'failure'] as const)('W8 old-token %s cannot publish while its replacement is still PROCESSING', async late => {
    const f = await queuedFixture()
    const firstEntered = deferred<void>()
    const secondEntered = deferred<void>()
    const releaseFirst = deferred<void>()
    const releaseSecond = deferred<void>()
    vi.mocked(generateResumeSuggestion).mockImplementationOnce(async () => {
      firstEntered.resolve(); await releaseFirst.promise
      return late === 'success' ? success('OLD_RESULT_SENTINEL') : { ok: false, reason: 'unavailable' }
    }).mockImplementationOnce(async () => {
      secondEntered.resolve(); await releaseSecond.promise
      return success('Replacement result')
    })
    const first = start(f)
    let second: ReturnType<typeof start> | undefined
    try {
      await bounded(firstEntered.promise)
      const original = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
      await testDb.resumeParseDraft.update({ where: { resumeId: f.resume.id }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } })
      second = start(f)
      await bounded(secondEntered.promise)
      const replacement = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
      expect(replacement).toMatchObject({ state: 'PROCESSING', attempts: 2, payload: null })
      expect(replacement.leaseToken).toBeTruthy()
      expect(replacement.leaseToken).not.toBe(original.leaseToken)
      releaseFirst.resolve()
      await finish(first)
      expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toEqual(replacement)
    } finally {
      releaseFirst.resolve(); releaseSecond.resolve()
      const results = await Promise.allSettled([finish(first), ...(second ? [finish(second)] : [])])
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toMatchObject({
      state: 'READY', attempts: 2, payload: { headline: 'Replacement result' }, leaseToken: null,
    })
    await unchanged(f)
  })

  it.each([
    ['refusal', 'PROVIDER_REFUSAL'], ['truncated', 'OUTPUT_TRUNCATED'], ['invalid', 'OUTPUT_INVALID'],
  ] as const)('W9 provider %s is a terminal private failure', async (reason, code) => {
    const f = await queuedFixture()
    vi.mocked(generateResumeSuggestion).mockResolvedValueOnce({ ok: false, reason })
    await finish(start(f))
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toMatchObject({
      state: 'FAILED', failureCode: code, payload: null, nextAttemptAt: null,
    })
    await unchanged(f)
    await noRaw()
  })

  it.each(['missing', 'empty-object', 'empty-suggestion', 'invalid-date', 'oversized'] as const)('W9 rejects unpersistable candidate %s in the real worker', async kind => {
    const f = await queuedFixture()
    const output = kind === 'missing' ? null : kind === 'empty-object' ? {}
      : kind === 'empty-suggestion' ? { headline: null, summary: null, skills: [], languages: [], educations: [], experiences: [] }
        : kind === 'invalid-date' ? { ...T01_SUGGESTION, educations: [{ ...T01_SUGGESTION.educations[0], startDate: '2026-02-30' }] }
          : { ...T01_SUGGESTION, summary: 'x'.repeat(128 * 1024 + 1) }
    vi.mocked(generateResumeSuggestion).mockResolvedValueOnce({ ok: true, output, responseModel: 'synthetic-response-model' })
    await finish(start(f))
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toMatchObject({
      state: 'FAILED', failureCode: 'OUTPUT_INVALID', payload: null,
    })
    await unchanged(f)
    await noRaw()
  })

  it('W9 recursively redacts allowed strings and strips unknown nested fields before READY', async () => {
    const f = await queuedFixture()
    const contact = 'nested-contact@example.test'
    const unknown = 'PRIVATE_UNKNOWN_FIELD_SENTINEL'
    vi.mocked(generateResumeSuggestion).mockResolvedValueOnce({ ok: true, responseModel: 'synthetic-response-model', output: {
      ...T01_SUGGESTION, phone: unknown, summary: `Career summary ${contact}`,
      educations: [{ ...T01_SUGGESTION.educations[0], description: `Career education ${contact}`, studentId: unknown }],
      experiences: [{ ...T01_SUGGESTION.experiences[0], title: `Project ${contact}`, organization: `Company ${contact}`, description: `Built product ${contact}`, id: unknown }],
    } })
    await finish(start(f))
    const draft = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
    expect(draft.state).toBe('READY')
    expect(JSON.stringify(draft.payload)).toContain('Career education')
    expect(JSON.stringify(draft.payload)).not.toContain(contact)
    expect(JSON.stringify(draft.payload)).not.toContain(unknown)
    await unchanged(f)
    await noRaw([INPUT, RAW_ERROR, contact, unknown])
  })

  it('W9 unexpected provider exceptions never reach logs, audits or draft as raw errors', async () => {
    const f = await queuedFixture()
    vi.mocked(generateResumeSuggestion).mockRejectedValueOnce(new Error(RAW_ERROR))
    await finish(start(f))
    expect(generateResumeSuggestion).toHaveBeenCalledOnce()
    await noReady(f)
    await unchanged(f)
    await noRaw()
  })

  it.each(['storage', 'rate_limited', 'unavailable', 'timeout', 'extract-timeout'] as const)('W10 %s retries only when due and stops after three claims', async failure => {
    const f = await queuedFixture()
    if (failure === 'storage') vi.mocked(getObjectBytes).mockRejectedValue(new Error(RAW_ERROR))
    else if (failure === 'extract-timeout') vi.mocked(extractResumeText).mockResolvedValue({ ok: false, reason: 'timeout' })
    else vi.mocked(generateResumeSuggestion).mockResolvedValue({ ok: false, reason: failure })
    for (const attempt of [1, 2]) {
      await finish(start(f))
      const row = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
      expect(row.attempts).toBe(attempt)
      expect(row.payload).toBeNull()
      expect(row.state).toBe('QUEUED')
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())
      const reads = vi.mocked(getObjectBytes).mock.calls.length
      await finish(start(f))
      expect(getObjectBytes).toHaveBeenCalledTimes(reads)
      expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toEqual(row)
      await testDb.resumeParseDraft.update({ where: { resumeId: f.resume.id }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } })
    }
    await finish(start(f))
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toMatchObject({
      state: 'FAILED', attempts: 3, failureCode: 'ATTEMPTS_EXHAUSTED', nextAttemptAt: null, payload: null,
    })
    expect(getObjectBytes).toHaveBeenCalledTimes(3)
    await finish(start(f))
    expect(getObjectBytes).toHaveBeenCalledTimes(3)
    await unchanged(f)
    await noRaw()
  })

  it.each([
    ['invalid', 'PDF_INVALID'], ['encrypted', 'PDF_ENCRYPTED'], ['empty', 'PDF_NO_TEXT'],
    ['too_many_pages', 'PDF_TOO_MANY_PAGES'], ['input_limit', 'PDF_LIMIT'],
    ['text_limit', 'PDF_LIMIT'], ['output_limit', 'PDF_LIMIT'], ['protocol_error', 'PDF_INVALID'],
  ] as const)('W10 extractor %s is terminal and never invokes the provider', async (reason, code) => {
    const f = await queuedFixture()
    vi.mocked(extractResumeText).mockResolvedValueOnce({ ok: false, reason })
    await finish(start(f))
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toMatchObject({
      state: 'FAILED', attempts: 1, failureCode: code, payload: null, nextAttemptAt: null,
    })
    await finish(start(f))
    expect(extractResumeText).toHaveBeenCalledOnce()
    expect(generateResumeSuggestion).not.toHaveBeenCalled()
  })

  it('W11 an already-aborted job does not claim or read', async () => {
    const f = await queuedFixture()
    const controller = new AbortController()
    controller.abort()
    await finish(start(f, controller.signal))
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toEqual(f.draft)
    expect(getObjectBytes).not.toHaveBeenCalled()
    expect(generateResumeSuggestion).not.toHaveBeenCalled()
  })

  it('W11 cancellation reaches extraction and job completion waits for the adapter close boundary', async () => {
    const f = await queuedFixture()
    const entered = deferred<void>()
    const aborted = deferred<void>()
    const closed = deferred<void>()
    const controller = new AbortController()
    vi.mocked(extractResumeText).mockImplementationOnce(async (_bytes, { signal }) => {
      signal.addEventListener('abort', () => aborted.resolve(), { once: true })
      if (signal.aborted) aborted.resolve()
      entered.resolve()
      await closed.promise
      return { ok: false, reason: 'aborted' }
    })
    let completed = false
    const work = start(f, controller.signal).then(result => { completed = true; return result })
    try {
      await bounded(entered.promise)
      controller.abort()
      await bounded(aborted.promise)
      await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
      expect(completed).toBe(false)
      expect(generateResumeSuggestion).not.toHaveBeenCalled()
    } finally { closed.resolve(); await finish(work) }
    await noReady(f)
    await unchanged(f)
  })

  it('W11 an aborted provider call cannot publish even if the external operation later returns success', async () => {
    const f = await queuedFixture()
    const entered = deferred<void>()
    const aborted = deferred<void>()
    const release = deferred<void>()
    const controller = new AbortController()
    vi.mocked(generateResumeSuggestion).mockImplementationOnce(async (_input, { signal }) => {
      signal.addEventListener('abort', () => aborted.resolve(), { once: true })
      if (signal.aborted) aborted.resolve()
      entered.resolve(); await release.promise
      return success()
    })
    const work = start(f, controller.signal)
    try {
      await bounded(entered.promise)
      controller.abort()
      await bounded(aborted.promise)
    } finally { release.resolve(); await finish(work) }
    expect(generateResumeSuggestion).toHaveBeenCalledOnce()
    await noReady(f)
    await unchanged(f)
  })
})
