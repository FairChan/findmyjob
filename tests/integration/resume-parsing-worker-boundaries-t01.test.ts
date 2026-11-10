import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const barrier = vi.hoisted(() => ({
  ready: null as null | { draftId: string; entered: (count: number) => void; release: Promise<void> },
}))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb.$extends({ query: { resumeParseDraft: {
    async updateMany({ args, query }) {
      // Preserve the real query, transaction and write. Only delay its resolution
      // after READY has been written inside the still-uncommitted transaction.
      const result = await query(args)
      const active = barrier.ready
      if (active && args.where?.id === active.draftId && args.data.state === 'READY') {
        barrier.ready = null
        active.entered(result.count)
        await active.release
      }
      return result
    },
  } } }) }
})
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-queue-job'),
} }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: vi.fn(), deleteAllVersions: vi.fn() }))
vi.mock('@/server/lib/resume-text', async original => ({
  ...await original<typeof import('@/server/lib/resume-text')>(), extractResumeText: vi.fn(),
}))
vi.mock('@/server/lib/ai/resume-provider', () => ({ generateResumeSuggestion: vi.fn() }))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-key', AI_MODEL_PARSE: 'synthetic-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { runResumeParse } from '@/server/jobs/parse-resume'
import { requestResumeParse } from '@/server/services/resume-parsing'
import { clearSettingsCache } from '@/server/services/settings'
import { getObjectBytes } from '@/lib/storage'
import { extractResumeText } from '@/server/lib/resume-text'
import { generateResumeSuggestion } from '@/server/lib/ai/resume-provider'
import {
  seedT01Gate, seedT01Resume, seedT01Student, snapshotT01Profile, T01_BYTES, T01_SUGGESTION,
} from '../helpers/resume-parsing-t01'

setupTestDb()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic barrier not reached')), 4_000) }),
    ])
  } finally { clearTimeout(timer) }
}
async function fixture(pageCount = 1) {
  await seedT01Gate()
  const student = await seedT01Student()
  const created = await seedT01Resume(student)
  const resume = await testDb.resumeFile.update({ where: { id: created.id }, data: { pageCount } })
  await requestResumeParse({ userId: student.userId }, { resumeId: resume.id })
  const draft = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: resume.id } })
  const profile = await snapshotT01Profile(student.profileId)
  return { student, resume, draft, profile }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function start(f: Fixture, signal?: AbortSignal) {
  return runResumeParse({ resumeId: f.resume.id, generation: f.draft.generation }, { signal })
    .then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
}
async function finish(work: ReturnType<typeof start>) {
  const outcome = await bounded(work)
  if (!outcome.ok) throw outcome.error
}
async function unchanged(f: Fixture) {
  expect(await snapshotT01Profile(f.student.profileId)).toEqual(f.profile)
  expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: f.resume.id } })).parsedJson)
    .toEqual(f.resume.parsedJson)
}
async function pageSetting(value: Prisma.InputJsonValue | typeof Prisma.JsonNull) {
  await testDb.systemSetting.upsert({
    where: { key: 'resume.maxPages' },
    create: { key: 'resume.maxPages', value }, update: { value },
  })
  clearSettingsCache()
}
beforeEach(() => {
  barrier.ready = null
  vi.clearAllMocks()
  clearSettingsCache()
  vi.mocked(getObjectBytes).mockReset().mockResolvedValue(T01_BYTES)
  vi.mocked(extractResumeText).mockReset().mockResolvedValue({ ok: true, text: 'Synthetic career facts', pageCount: 1 })
  vi.mocked(generateResumeSuggestion).mockReset().mockResolvedValue({
    ok: true, output: T01_SUGGESTION, responseModel: 'synthetic-response-model',
  })
})

describe('T01 configured extraction page limits', () => {
  it.each(['missing', 'explicit-default'] as const)('uses the twenty-page default for %s configuration', async kind => {
    if (kind === 'explicit-default') await pageSetting(20)
    else await testDb.systemSetting.deleteMany({ where: { key: 'resume.maxPages' } })
    const f = await fixture()
    await finish(start(f))
    expect(extractResumeText).toHaveBeenCalledExactlyOnceWith(T01_BYTES, {
      maxPages: 20, signal: expect.any(AbortSignal),
    })
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } }))
      .toMatchObject({ state: 'READY', payload: T01_SUGGESTION })
    await unchanged(f)
  })

  it('honors a thirty-page policy for a twenty-five-page uploaded source', async () => {
    await pageSetting(30)
    const f = await fixture(25)
    vi.mocked(extractResumeText).mockImplementationOnce(async (_bytes, { maxPages }) => maxPages < 25
      ? { ok: false, reason: 'too_many_pages' }
      : { ok: true, text: 'Synthetic career facts from twenty-five pages', pageCount: 25 })
    await finish(start(f))
    expect(extractResumeText).toHaveBeenCalledExactlyOnceWith(T01_BYTES, {
      maxPages: 30, signal: expect.any(AbortSignal),
    })
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } }))
      .toMatchObject({ state: 'READY', payload: T01_SUGGESTION })
    expect(generateResumeSuggestion).toHaveBeenCalledOnce()
    await unchanged(f)
  })

  it('enforces a reduced five-page policy for an existing ten-page source', async () => {
    const f = await fixture(10)
    await pageSetting(5)
    vi.mocked(extractResumeText).mockImplementationOnce(async (_bytes, { maxPages }) => maxPages < 10
      ? { ok: false, reason: 'too_many_pages' }
      : { ok: true, text: 'Synthetic career facts from ten pages', pageCount: 10 })
    await finish(start(f))
    expect(extractResumeText).toHaveBeenCalledExactlyOnceWith(T01_BYTES, {
      maxPages: 5, signal: expect.any(AbortSignal),
    })
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } }))
      .toMatchObject({ state: 'FAILED', failureCode: 'PDF_TOO_MANY_PAGES', payload: null, nextAttemptAt: null })
    expect(generateResumeSuggestion).not.toHaveBeenCalled()
    await unchanged(f)
  })

  it.each([
    { label: 'zero', value: 0 },
    { label: 'above maximum', value: 101 },
    { label: 'fraction', value: 1.5 },
    { label: 'string', value: '20' },
    { label: 'boolean', value: true },
    { label: 'null', value: Prisma.JsonNull },
    { label: 'object', value: { limit: 20 } },
  ])('fails closed before extraction for an invalid $label setting', async ({ value }) => {
    const f = await fixture()
    await pageSetting(value)
    // A controlled job failure may retain the finite lease; no particular new
    // persisted configuration-error code is prescribed by this regression.
    const outcome = await bounded(start(f))
    const errorCode = outcome.ok ? null : (outcome.error as { code?: unknown })?.code
    expect([null, 'RESUME_PARSE_JOB_FAILED']).toContain(errorCode)
    expect(extractResumeText).not.toHaveBeenCalled()
    expect(generateResumeSuggestion).not.toHaveBeenCalled()
    const draft = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
    expect(draft.state).not.toBe('READY')
    expect(draft.payload).toBeNull()
    await unchanged(f)
  })
})

describe('T01 cancellation inside the READY write transaction', () => {
  it('rolls back an actual pending READY write after abort and later recovers the generation', async () => {
    const f = await fixture()
    const entered = deferred<number>()
    const release = deferred<void>()
    const controller = new AbortController()
    barrier.ready = { draftId: f.draft.id, entered: entered.resolve, release: release.promise }
    const work = start(f, controller.signal)
    try {
      const changed = await bounded(Promise.race([
        entered.promise, work.then(() => { throw new Error('Worker completed before READY-write barrier') }),
      ]))
      expect(changed).toBe(1)
      controller.abort(new Error('SYNTHETIC_ABORT_DURING_READY'))
      expect(controller.signal.aborted).toBe(true)
    } finally {
      controller.abort()
      release.resolve()
      barrier.ready = null
      await finish(work)
    }
    const abandoned = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
    expect(['QUEUED', 'PROCESSING']).toContain(abandoned.state)
    expect(abandoned).toMatchObject({ generation: f.draft.generation, attempts: 1, payload: null })
    await unchanged(f)

    // Make recovery due using persisted dates, not fake JS clocks or a new generation.
    await testDb.resumeParseDraft.update({ where: { id: abandoned.id }, data: abandoned.state === 'QUEUED'
      ? { nextAttemptAt: new Date(Date.now() - 1_000) }
      : { leaseExpiresAt: new Date(Date.now() - 1_000) } })
    await finish(start(f))
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } }))
      .toMatchObject({ state: 'READY', generation: f.draft.generation, attempts: 2, payload: T01_SUGGESTION })
    expect(generateResumeSuggestion).toHaveBeenCalledTimes(2)
    await unchanged(f)
  })
})
