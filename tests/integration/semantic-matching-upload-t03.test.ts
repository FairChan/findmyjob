import { PDFDocument } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: { start: vi.fn(), send: vi.fn().mockResolvedValue('synthetic-job') } }))
vi.mock('@/server/lib/ai/embedding-provider', () => ({ embedMatchingText: vi.fn() }))
vi.mock('@/server/lib/semantic-store', () => ({
  isSemanticStoreAvailable: vi.fn().mockResolvedValue(true), findTalentNeighbors: vi.fn(), findJobNeighbors: vi.fn(),
  writeSemanticVector: vi.fn(), deleteSemanticVector: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({ putObject: vi.fn(), deleteAllVersions: vi.fn(), getObjectBytes: vi.fn() }))
vi.mock('@/server/lib/logger', () => ({ logger: { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, VOYAGE_API_KEY: 'synthetic-key', AI_MODEL_EMBED: 'synthetic-embedding-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { seedT03Gate, t03Student, readyT03Student } from '../helpers/semantic-matching-t03'
import { seedT01Resume } from '../helpers/resume-parsing-t01'
import { getSession } from '@/server/auth'
import { POST } from '@/app/api/uploads/[purpose]/route'
import { clearSettingsCache } from '@/server/services/settings'
import { putObject } from '@/lib/storage'
import { embedMatchingText } from '@/server/lib/ai/embedding-provider'

setupTestDb()
const ORIGIN = 'https://matching-upload.example.test'
beforeEach(async () => {
  vi.clearAllMocks(); clearSettingsCache(); vi.stubEnv('APP_URL', ORIGIN)
  vi.mocked(putObject).mockResolvedValue(undefined)
  await seedT03Gate()
})
afterEach(() => { vi.unstubAllEnvs() })

async function authenticate(userId: string) {
  const user = await testDb.user.findUniqueOrThrow({ where: { id: userId } }), now = new Date()
  vi.mocked(getSession).mockResolvedValue({ user: user as never, session: {
    id: 'synthetic-session', userId, token: 'synthetic-token', expiresAt: new Date(Date.now() + 86_400_000),
    ipAddress: null, userAgent: null, createdAt: now, updatedAt: now,
  } })
}
async function upload() {
  const pdf = await PDFDocument.create(); pdf.addPage().drawText('Synthetic career attachment')
  const form = new FormData()
  form.set('file', new File([new Uint8Array(await pdf.save())], 'synthetic.pdf', { type: 'application/pdf' }))
  return POST(new Request(ORIGIN + '/api/uploads/RESUME', { method: 'POST', headers: { Origin: ORIGIN }, body: form }))
}

describe('M9-T03 upload eligibility hook', () => {
  it.each([false, true])('upload with existing resume=%s changes revision only when completeness changes', async existing => {
    const student = await t03Student(), index = await readyT03Student(student)
    if (existing) await seedT01Resume(student)
    const before = await testDb.studentProfile.update({ where: { id: student.profileId }, data: { completeness: existing ? 30 : 20 } })
    await authenticate(student.userId)
    expect((await upload()).status).toBe(200)
    expect(await testDb.resumeFile.count({ where: { studentId: student.profileId } })).toBe(existing ? 2 : 1)
    expect(await testDb.studentProfile.findUniqueOrThrow({ where: { id: student.profileId } })).toMatchObject({
      completeness: 30, editRevision: before.editRevision + (existing ? 0 : 1),
    })
    expect(await testDb.semanticIndex.findUniqueOrThrow({ where: { id: index.id } })).toMatchObject({
      state: existing ? 'READY' : 'CANCELLED', generation: index.generation + (existing ? 0 : 1),
    })
    expect(embedMatchingText).not.toHaveBeenCalled()
  })
})
