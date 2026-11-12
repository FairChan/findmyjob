import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job'),
} }))
vi.mock('@/lib/storage', () => ({
  putObject: vi.fn().mockResolvedValue(undefined), deleteAllVersions: vi.fn().mockResolvedValue(undefined), getObjectBytes: vi.fn(),
}))
vi.mock('@/server/lib/logger', () => ({ logger: {
  fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
} }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-key', AI_MODEL_PARSE: 'synthetic-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { seedT01Gate, seedT01Student } from '../helpers/resume-parsing-t01'
import { getSession } from '@/server/auth'
import { POST } from '@/app/api/uploads/[purpose]/route'
import { putObject, deleteAllVersions, getObjectBytes } from '@/lib/storage'
import { sendBoss } from '@/server/jobs/boss'
import { clearSettingsCache } from '@/server/services/settings'
import { lockXact, LOCK_NS } from '@/server/lib/advisory-locks'
import { logger } from '@/server/lib/logger'

setupTestDb()
const ORIGIN = 'https://m9-upload-lifecycle.example.test'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  // A delayed queue failure must be observed even if an assertion exits early.
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic boundary timed out')), 5_000) }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}

async function sessionFor(userId: string) {
  const user = await testDb.user.findUniqueOrThrow({ where: { id: userId } })
  const now = new Date()
  vi.mocked(getSession).mockResolvedValue({ user: user as never, session: {
    id: 'synthetic-session', userId, token: 'synthetic-token', expiresAt: new Date(Date.now() + 86_400_000),
    ipAddress: null, userAgent: null, createdAt: now, updatedAt: now,
  } })
}

async function uploadRequest(parseIntent = false) {
  const pdf = await PDFDocument.create()
  pdf.addPage().drawText('Synthetic upload boundary document.')
  const bytes = new Uint8Array(await pdf.save())
  const form = new FormData()
  form.set('file', new File([bytes], 'synthetic-upload.pdf', { type: 'application/pdf' }))
  if (parseIntent) form.set('requestAiParse', 'true')
  return { bytes, request: new Request(ORIGIN + '/api/uploads/RESUME', {
    method: 'POST', headers: { Origin: ORIGIN }, body: form,
  }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache()
  vi.stubEnv('APP_URL', ORIGIN)
  vi.mocked(putObject).mockReset().mockResolvedValue(undefined)
  vi.mocked(deleteAllVersions).mockReset().mockResolvedValue(undefined)
  vi.mocked(sendBoss.start).mockReset().mockResolvedValue(sendBoss)
  vi.mocked(sendBoss.send).mockReset().mockResolvedValue('synthetic-job')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('M9-T01 upload lifecycle integration', () => {
  it.each(['DELETED', 'SUSPENDED', 'PROFILE_MISSING', 'PROFILE_TRANSFERRED'] as const)(
    'rechecks %s after a paused PUT while permitting lifecycle locks during external I/O', async change => {
      const student = await createStudent(testDb)
      const other = change === 'PROFILE_TRANSFERRED' ? await createStudent(testDb) : null
      await sessionFor(student.userId)
      const entered = deferred<void>(), release = deferred<void>()
      vi.mocked(putObject).mockImplementationOnce(async () => { entered.resolve(); await release.promise })
      const input = await uploadRequest(true)
      const uploading = POST(input.request)
      void uploading.catch(() => {})
      try {
        await bounded(entered.promise)
        // This must commit before releasing the PUT. No lock may span storage.
        await bounded(testDb.$transaction(async tx => {
          await lockXact(tx, LOCK_NS.STUDENT_DATA, student.userId)
          if (change === 'DELETED' || change === 'SUSPENDED') {
            await tx.user.update({ where: { id: student.userId }, data: {
              status: change, ...(change === 'DELETED' ? { deletedAt: new Date() } : {}),
            } })
          } else if (change === 'PROFILE_MISSING') {
            await tx.studentProfile.delete({ where: { id: student.profileId } })
          } else {
            await tx.studentProfile.delete({ where: { id: other!.profileId } })
            await tx.studentProfile.update({ where: { id: student.profileId }, data: { userId: other!.userId } })
          }
        }, { timeout: 4_000 }))
      } finally { release.resolve(); await bounded(uploading) }
      const response = await uploading
      expect(response.status).toBe(change === 'PROFILE_MISSING' ? 404 : 403)
      expect(await testDb.resumeFile.count()).toBe(0)
      expect(await testDb.resumeParseDraft.count()).toBe(0)
      expect(deleteAllVersions).toHaveBeenCalledExactlyOnceWith(vi.mocked(putObject).mock.calls[0][0])
      expect(sendBoss.start).not.toHaveBeenCalled()
      expect(getObjectBytes).not.toHaveBeenCalled()
    },
  )

  it('an explicit flag without an AI grant keeps the upload but cannot create consent or a draft', async () => {
    await seedT01Gate()
    const student = await seedT01Student()
    await testDb.consent.deleteMany({ where: { userId: student.userId, type: 'AI_RESUME_PARSE' } })
    await sessionFor(student.userId)
    const consents = await testDb.consent.findMany({ where: { userId: student.userId }, orderBy: { id: 'asc' } })
    const input = await uploadRequest(true)
    const response = await POST(input.request)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.parseRequest).toEqual({ state: 'unavailable' })
    expect(await testDb.resumeFile.findUniqueOrThrow({ where: { id: body.resumeId } })).toMatchObject({
      studentId: student.profileId, contentSha256: createHash('sha256').update(input.bytes).digest('hex'),
    })
    expect(await testDb.consent.findMany({ where: { userId: student.userId }, orderBy: { id: 'asc' } })).toEqual(consents)
    expect(await testDb.resumeParseDraft.count()).toBe(0)
    expect(sendBoss.start).not.toHaveBeenCalled()
    expect(deleteAllVersions).not.toHaveBeenCalled()
    expect(getObjectBytes).not.toHaveBeenCalled()
  })

  it.each(['start-rejects', 'send-pending'] as const)('isolates queue %s after the upload and durable parse request commit', async failure => {
    await seedT01Gate()
    const student = await seedT01Student()
    await sessionFor(student.userId)
    const late = deferred<string | null>()
    const sentinel = 'PRIVATE_LATE_QUEUE_ERROR'
    if (failure === 'start-rejects') vi.mocked(sendBoss.start).mockRejectedValueOnce(new Error(sentinel))
    else vi.mocked(sendBoss.send).mockImplementationOnce(() => late.promise)
    const input = await uploadRequest(true)
    let response: Response
    try { response = await bounded(POST(input.request)) }
    finally { late.reject(new Error(sentinel)); await Promise.resolve() }
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.parseRequest).toMatchObject({ state: 'QUEUED', dispatch: 'pending' })
    const resume = await testDb.resumeFile.findUniqueOrThrow({ where: { id: body.resumeId } })
    const draft = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: resume.id } })
    expect(resume.contentSha256).toBe(createHash('sha256').update(input.bytes).digest('hex'))
    expect(draft).toMatchObject({ state: 'QUEUED', sourceStorageKey: resume.storageKey, sourceSha256: resume.contentSha256 })
    expect(deleteAllVersions).not.toHaveBeenCalled()
    expect(getObjectBytes).not.toHaveBeenCalled()
    expect(JSON.stringify([body, vi.mocked(logger.warn).mock.calls])).not.toContain(sentinel)
  })
})
