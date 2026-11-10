import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job'),
} }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: vi.fn() }))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-key', AI_MODEL_PARSE: 'synthetic-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { getResumeParseUiState, setResumeParseConsent } from '@/server/services/resume-parsing'
import { clearSettingsCache } from '@/server/services/settings'
import * as auditModule from '@/server/services/audit'
import { readyT01Fixture, T01_VERSION } from '../helpers/resume-parsing-t01'

setupTestDb()
beforeEach(() => { vi.clearAllMocks(); clearSettingsCache() })

async function invalidateLegalSettings() {
  for (const key of ['legal.currentVersion', 'ai.resumeParse']) {
    await testDb.systemSetting.upsert({
      where: { key }, create: { key, value: { invalid: true } }, update: { value: { invalid: true } },
    })
  }
}

describe('M9-T01 withdrawal without a usable policy version', () => {
  it.each(['omitted', 'null'] as const)('accepts %s submittedVersion and commits withdrawal/cancellation', async mode => {
    const f = await readyT01Fixture()
    await invalidateLegalSettings()
    expect(await getResumeParseUiState(f.ctx)).toEqual({ available: false, consentGranted: true, legalVersion: null })
    const input = mode === 'null' ? { granted: false as const, submittedVersion: null } : { granted: false as const }
    await expect(setResumeParseConsent(f.ctx, input)).resolves.toEqual({ granted: false, version: T01_VERSION })
    const draft = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
    expect(draft).toMatchObject({
      state: 'CANCELLED', generation: f.draft.generation + 1, payload: null, leaseToken: null, leaseExpiresAt: null,
    })
    const history = await testDb.consent.findMany({
      where: { userId: f.student.userId, type: 'AI_RESUME_PARSE' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    expect(history.map(item => [item.granted, item.version])).toEqual([[true, T01_VERSION], [false, T01_VERSION]])
    expect(history[1]!.createdAt.getTime()).toBeGreaterThan(history[0]!.createdAt.getTime())
    expect(await getResumeParseUiState(f.ctx)).toEqual({ available: false, consentGranted: false, legalVersion: null })
    const audits = await testDb.auditLog.findMany({
      where: { actorId: f.student.userId, action: 'resume.parse.consent' },
    })
    expect(audits.map(item => item.metadata)).toContainEqual({ granted: false, version: T01_VERSION })
  })

  it('records a withdrawal with the existing legal default when no AI history exists', async () => {
    const student = await createStudent(testDb)
    await invalidateLegalSettings()
    await expect(setResumeParseConsent({ userId: student.userId }, { granted: false }))
      .resolves.toEqual({ granted: false, version: '2026-11-draft' })
    expect(await testDb.consent.findMany({ where: { userId: student.userId, type: 'AI_RESUME_PARSE' } }))
      .toEqual([expect.objectContaining({ granted: false, version: '2026-11-draft' })])
  })

  it('rolls back the withdrawal and cancellation together when its audit fails', async () => {
    const f = await readyT01Fixture()
    await invalidateLegalSettings()
    const original = auditModule.logAudit
    const spy = vi.spyOn(auditModule, 'logAudit').mockImplementation(async (params, tx) => {
      await original(params, tx)
      if (params.action === 'resume.parse.consent') throw new Error('synthetic-consent-audit-failure')
    })
    try { await expect(setResumeParseConsent(f.ctx, { granted: false })).rejects.toThrow() }
    finally { spy.mockRestore() }
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toEqual(f.draft)
    expect(await testDb.consent.count({ where: { userId: f.student.userId, type: 'AI_RESUME_PARSE' } })).toBe(1)
    expect(await testDb.auditLog.count({ where: { actorId: f.student.userId, action: 'resume.parse.consent' } })).toBe(1)
  })
})
