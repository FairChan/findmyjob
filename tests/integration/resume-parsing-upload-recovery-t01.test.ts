import { createHash, randomUUID } from 'node:crypto'
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
vi.mock('@/server/lib/resume-text', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/lib/resume-text')>(), extractResumeText: vi.fn(),
}))
vi.mock('@/server/lib/ai/resume-provider', () => ({ generateResumeSuggestion: vi.fn() }))
vi.mock('@/server/lib/logger', () => ({ logger: {
  fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
} }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-key', AI_MODEL_PARSE: 'synthetic-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { getSession } from '@/server/auth'
import { POST } from '@/app/api/uploads/[purpose]/route'
import { putObject, deleteAllVersions } from '@/lib/storage'
import { extractResumeText } from '@/server/lib/resume-text'
import { generateResumeSuggestion } from '@/server/lib/ai/resume-provider'
import { sendBoss } from '@/server/jobs/boss'
import { dispatchPendingResumeParses, requestResumeParse } from '@/server/services/resume-parsing'
import { clearSettingsCache } from '@/server/services/settings'
import { seedT01Gate, seedT01Resume, seedT01Student } from '../helpers/resume-parsing-t01'

setupTestDb()
const ORIGIN = 'https://m9-upload.example.test'

async function sessionFor(userId: string) {
  const user = await testDb.user.findUniqueOrThrow({ where: { id: userId } })
  const now = new Date()
  vi.mocked(getSession).mockResolvedValue({ user: user as never, session: {
    id: 'synthetic-session', userId, token: 'synthetic-token', expiresAt: new Date(Date.now() + 86_400_000),
    ipAddress: null, userAgent: null, createdAt: now, updatedAt: now,
  } })
}

async function uploadRequest(requestAiParse: boolean) {
  const pdf = await PDFDocument.create()
  pdf.addPage().drawText('Synthetic career document; no real person.')
  const bytes = new Uint8Array(await pdf.save())
  const form = new FormData()
  form.set('file', new File([bytes], 'synthetic-career.pdf', { type: 'application/pdf' }))
  if (requestAiParse) form.set('requestAiParse', 'true')
  return {
    bytes,
    request: new Request(ORIGIN + '/api/uploads/RESUME', { method: 'POST', headers: { Origin: ORIGIN }, body: form }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache()
  vi.stubEnv('APP_URL', ORIGIN)
  vi.mocked(sendBoss.send).mockReset().mockResolvedValue('synthetic-job')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('M9-T01 upload/recovery failure isolation', () => {
  it('W12 queue outage preserves upload and its durable request; dispatcher resends only identifiers', async () => {
    await seedT01Gate()
    const student = await seedT01Student()
    await sessionFor(student.userId)
    vi.mocked(sendBoss.send).mockRejectedValueOnce(new Error('synthetic-queue-unavailable'))
    const input = await uploadRequest(true)
    const response = await POST(input.request)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, resumeId: expect.any(String), key: expect.any(String) })
    const resume = await testDb.resumeFile.findUniqueOrThrow({ where: { id: body.resumeId } })
    expect(resume).toMatchObject({
      studentId: student.profileId, storageKey: body.key,
      contentSha256: createHash('sha256').update(input.bytes).digest('hex'),
    })
    const draft = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: resume.id } })
    expect(draft).toMatchObject({ state: 'QUEUED', sourceStorageKey: resume.storageKey, sourceSha256: resume.contentSha256 })
    expect(putObject).toHaveBeenCalledOnce()
    expect(deleteAllVersions).not.toHaveBeenCalled()
    expect(extractResumeText).not.toHaveBeenCalled()
    expect(generateResumeSuggestion).not.toHaveBeenCalled()
    vi.mocked(sendBoss.send).mockClear()
    await dispatchPendingResumeParses()
    const sent = vi.mocked(sendBoss.send).mock.calls.filter(call => call[0] === 'resume-parse')
    expect(sent).toHaveLength(1)
    expect(sent[0][1]).toEqual({ resumeId: resume.id, generation: draft.generation })
    expect(await testDb.resumeFile.findUniqueOrThrow({ where: { id: resume.id } })).toEqual(resume)
    expect(await testDb.resumeParseDraft.count({ where: { resumeId: resume.id } })).toBe(1)
    expect(generateResumeSuggestion).not.toHaveBeenCalled()
  })

  it.each([false, true])('W12 legacy upload without parse intent never creates a grant/request (prior grant=%s)', async granted => {
    await seedT01Gate()
    const student = granted ? await seedT01Student() : await createStudent(testDb)
    await sessionFor(student.userId)
    const consents = await testDb.consent.findMany({ where: { userId: student.userId, type: 'AI_RESUME_PARSE' }, orderBy: { id: 'asc' } })
    const input = await uploadRequest(false)
    const response = await POST(input.request)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(await testDb.resumeFile.count({ where: { id: body.resumeId, studentId: student.profileId } })).toBe(1)
    expect(await testDb.resumeParseDraft.count()).toBe(0)
    expect(await testDb.consent.findMany({ where: { userId: student.userId, type: 'AI_RESUME_PARSE' }, orderBy: { id: 'asc' } })).toEqual(consents)
    expect(sendBoss.send).not.toHaveBeenCalled()
    expect(extractResumeText).not.toHaveBeenCalled()
    expect(generateResumeSuggestion).not.toHaveBeenCalled()
  })

  it.each(['QUEUED', 'PROCESSING'] as const)('W12 dispatcher recovers due %s but skips future retries and active leases', async state => {
    await seedT01Gate()
    const student = await seedT01Student()
    const resumes = await Promise.all([seedT01Resume(student), seedT01Resume(student), seedT01Resume(student)])
    const requested = []
    for (const resume of resumes) requested.push(await requestResumeParse({ userId: student.userId }, { resumeId: resume.id }))
    await testDb.resumeParseDraft.update({ where: { resumeId: resumes[0].id }, data: state === 'QUEUED'
      ? { nextAttemptAt: new Date(Date.now() - 1_000) }
      : { state: 'PROCESSING', attempts: 1, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) },
    })
    await testDb.resumeParseDraft.update({ where: { resumeId: resumes[1].id }, data: { nextAttemptAt: new Date(Date.now() + 60_000) } })
    await testDb.resumeParseDraft.update({ where: { resumeId: resumes[2].id }, data: {
      state: 'PROCESSING', attempts: 1, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000),
    } })
    vi.mocked(sendBoss.send).mockClear()
    await dispatchPendingResumeParses()
    const sent = vi.mocked(sendBoss.send).mock.calls.filter(call => call[0] === 'resume-parse')
    expect(sent).toHaveLength(1)
    expect(sent[0][1]).toEqual({ resumeId: resumes[0].id, generation: requested[0].generation })
    expect(extractResumeText).not.toHaveBeenCalled()
    expect(generateResumeSuggestion).not.toHaveBeenCalled()
  })
})
