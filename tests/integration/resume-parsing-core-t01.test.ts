import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-queue-job'),
} }))
vi.mock('@/lib/storage', () => ({
  getObjectBytes: vi.fn(), deleteAllVersions: vi.fn().mockResolvedValue(undefined),
} ))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/env', async importOriginal => {
  const actual = await importOriginal<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-test-key', AI_MODEL_PARSE: 'synthetic-test-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createStudent } from '../factories'
import { AppError } from '@/server/errors'
import {
  confirmResumeParse, discardResumeParseDraft, getResumeParseDraft,
  requestResumeParse, setResumeParseConsent,
} from '@/server/services/resume-parsing'
import { recordConsents } from '@/server/services/consent'
import * as auditModule from '@/server/services/audit'
import { clearSettingsCache, getSetting } from '@/server/services/settings'
import { recalcOwnCompleteness, saveStep1, saveStep2, saveStep3, saveStep4 } from '@/server/services/student-profile'
import {
  readyT01Fixture, readyT01Resume, seedT01Gate, seedT01Resume, seedT01Student,
  snapshotT01Profile, T01_SUGGESTION, T01_VERSION,
} from '../helpers/resume-parsing-t01'

setupTestDb()
beforeEach(() => { vi.clearAllMocks(); clearSettingsCache() })

describe('M9-T01 private ownership', () => {
  it.each(['read', 'request', 'confirm', 'discard'] as const)('wrong owner cannot %s a draft', async operation => {
    const f = await readyT01Fixture()
    const other = await createStudent(testDb)
    const ctx = { userId: other.userId }
    const call = operation === 'read' ? getResumeParseDraft(ctx, { resumeId: f.resume.id })
      : operation === 'request' ? requestResumeParse(ctx, { resumeId: f.resume.id })
        : operation === 'discard' ? discardResumeParseDraft(ctx, { resumeId: f.resume.id, generation: f.draft.generation })
          : confirmResumeParse(ctx, { ...f.confirmation, patch: { headline: 'Unauthorized' } })
    await expect(call).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toEqual(f.draft)
    expect(await testDb.studentProfile.findUniqueOrThrow({ where: { id: f.student.profileId } })).toEqual(f.profile)
  })

  it.each(['ADMIN', 'EMPLOYER', 'DELETED'] as const)('rejects %s even with a direct service call', async actor => {
    const f = await readyT01Fixture()
    let userId = f.student.userId
    if (actor === 'ADMIN') userId = (await createAdmin(testDb)).userId
    else if (actor === 'EMPLOYER') userId = (await createEmployer(testDb)).userId
    else await testDb.user.update({ where: { id: userId }, data: { status: 'DELETED' } })
    await expect(getResumeParseDraft({ userId }, { resumeId: f.resume.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(confirmResumeParse({ userId }, { ...f.confirmation, patch: { headline: 'Unauthorized' } }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('owner can read a safe READY snapshot while the gate is disabled', async () => {
    const f = await readyT01Fixture()
    await testDb.systemSetting.update({
      where: { key: 'ai.resumeParse' }, data: { value: { enabled: false, legalVersion: T01_VERSION, epoch: randomUUID() } },
    })
    const dto = await getResumeParseDraft(f.ctx, { resumeId: f.resume.id })
    expect(dto).not.toBeNull()
    expect(Object.keys(dto!).sort()).toEqual([
      'resumeId', 'generation', 'state', 'payload', 'profileRevision', 'currentProfile',
      'failureCode', 'requestedAt', 'completedAt', 'confirmedAt', 'source',
    ].sort())
    expect(dto?.payload).toEqual(T01_SUGGESTION)
    expect(dto?.profileRevision).toBe(f.profile.editRevision)
    expect(dto?.currentProfile?.headline).toBe('Existing headline')
    expect(Object.keys(dto!.source).sort()).toEqual(['createdAt', 'fileName'])
    const json = JSON.stringify(dto)
    for (const value of [f.resume.storageKey, f.draft.consentGrantId, f.draft.gateEpoch, 'sourceStorageKey', 'leaseToken']) {
      expect(json).not.toContain(value)
    }
  })
})

describe('M9-T01 explicit confirmation', () => {
  it('rolls back profile, collections, revision and draft when the transactional audit fails', async () => {
    const f = await readyT01Fixture()
    const before = await snapshotT01Profile(f.student.profileId)
    const realAudit = auditModule.logAudit
    const spy = vi.spyOn(auditModule, 'logAudit').mockImplementation(async (params, tx) => {
      await realAudit(params, tx)
      if (params.action === 'resume.parse.confirm') throw new Error('synthetic-audit-failure')
    })
    try {
      await expect(confirmResumeParse(f.ctx, { ...f.confirmation, patch: {
        headline: 'Should roll back', educations: T01_SUGGESTION.educations,
      } })).rejects.toThrow()
    } finally { spy.mockRestore() }
    expect(await snapshotT01Profile(f.student.profileId)).toEqual(before)
    expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toEqual(f.draft)
    expect(await testDb.auditLog.count({ where: { action: 'resume.parse.confirm', actorId: f.student.userId } })).toBe(0)
  })

  it('applies only a selected field, increments once, and clears the private payload', async () => {
    const f = await readyT01Fixture()
    const before = await snapshotT01Profile(f.student.profileId)
    const result = await confirmResumeParse(f.ctx, { ...f.confirmation, patch: { headline: 'Approved headline' } })
    const after = await snapshotT01Profile(f.student.profileId)
    expect(result).toEqual({ appliedProfileRevision: before.editRevision + 1, alreadyApplied: false })
    expect(after.editRevision).toBe(before.editRevision + 1)
    expect(after.headline).toBe('Approved headline')
    for (const key of ['summary', 'skills', 'languages', 'educations', 'experiences', 'fullName', 'nationality', 'workAuth', 'schoolId', 'schoolEmail', 'schoolVerifiedAt', 'visibility', 'onboardingStep'] as const) {
      expect(after[key]).toEqual(before[key])
    }
    const draft = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
    expect(draft.state).toBe('CONFIRMED')
    expect(draft.payload).toBeNull()
    expect(draft.appliedProfileRevision).toBe(after.editRevision)
    expect(draft.confirmationHash).toMatch(/^[a-f0-9]{64}$/)
    expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: f.resume.id } })).parsedJson)
      .toEqual({ legacy: 'untouched-legacy' })
    const audits = await testDb.auditLog.findMany({ where: { action: 'resume.parse.confirm', actorId: f.student.userId } })
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits[0].metadata)).not.toContain('Approved headline')
  })

  it('projects nested fields, redacts contacts and assigns collection ownership and order on the server', async () => {
    const f = await readyT01Fixture()
    const other = await createStudent(testDb)
    const before = await snapshotT01Profile(f.student.profileId)
    const patch = {
      headline: 'Career headline', fullName: 'Injected identity', visibility: 'PUBLIC', schoolVerifiedAt: new Date().toISOString(),
      workAuth: 'MY_CITIZEN', onboardingStep: 5, completeness: 100,
      skills: [' TypeScript ', 'typescript', 'SQL'],
      educations: [{ ...T01_SUGGESTION.educations[0], id: 'client-education-id', studentId: other.profileId, sortOrder: 999,
        description: 'Write to education-contact@example.test' }],
      experiences: [{ ...T01_SUGGESTION.experiences[0], id: 'client-experience-id', studentId: other.profileId, sortOrder: 999,
        organization: 'https://example.test/private-contact', description: 'experience-contact@example.test' }],
    }
    await confirmResumeParse(f.ctx, { ...f.confirmation, patch })
    const after = await snapshotT01Profile(f.student.profileId)
    expect(after.skills).toEqual(['TypeScript', 'SQL'])
    for (const key of ['fullName', 'workAuth', 'visibility', 'schoolVerifiedAt', 'onboardingStep'] as const) {
      expect(after[key]).toEqual(before[key])
    }
    expect(after.educations).toHaveLength(1)
    expect(after.experiences).toHaveLength(1)
    for (const row of [...after.educations, ...after.experiences]) {
      expect(row.studentId).toBe(f.student.profileId)
      expect(row.id).toMatch(/^c[a-z0-9]{24}$/)
      expect(row.sortOrder).toBe(0)
    }
    expect(JSON.stringify(after)).not.toContain('education-contact@example.test')
    expect(JSON.stringify(after)).not.toContain('experience-contact@example.test')
    expect(JSON.stringify(after)).not.toContain('https://example.test/private-contact')
    expect(await testDb.education.count({ where: { studentId: other.profileId } })).toBe(0)
    expect(await testDb.experience.count({ where: { studentId: other.profileId } })).toBe(0)
  })

  it.each([{}, { fullName: 'Unknown-only patch' }])('rejects an empty whitelist projection: %j', async patch => {
    const f = await readyT01Fixture()
    // Deliberately bypass the static whitelist to exercise the runtime boundary.
    // @ts-expect-error unknown-only fields are forbidden by the service type too
    await expect(confirmResumeParse(f.ctx, { ...f.confirmation, patch })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(await testDb.studentProfile.findUniqueOrThrow({ where: { id: f.student.profileId } })).toEqual(f.profile)
  })

  it('explicit null and empty arrays clear only the selected groups', async () => {
    const f = await readyT01Fixture()
    await testDb.studentLanguage.create({ data: { studentId: f.student.profileId, language: 'English', level: 'FLUENT' } })
    await testDb.education.create({ data: { studentId: f.student.profileId, schoolName: 'Existing school' } })
    await confirmResumeParse(f.ctx, { ...f.confirmation, patch: { headline: null, languages: [], educations: [] } })
    const after = await snapshotT01Profile(f.student.profileId)
    expect(after.headline).toBeNull()
    expect(after.languages).toEqual([])
    expect(after.educations).toEqual([])
    expect(after.summary).toBe(f.profile.summary)
    expect(after.skills).toEqual(f.profile.skills)
  })

  it('canonical replay is idempotent and a different replay conflicts', async () => {
    const f = await readyT01Fixture()
    const first = await confirmResumeParse(f.ctx, { ...f.confirmation, patch: { headline: 'Chosen headline', summary: 'Chosen summary' } })
    const afterFirst = await snapshotT01Profile(f.student.profileId)
    const second = await confirmResumeParse(f.ctx, { ...f.confirmation, patch: { summary: 'Chosen summary', headline: 'Chosen headline' } })
    expect(second).toEqual({ appliedProfileRevision: first.appliedProfileRevision, alreadyApplied: true })
    await expect(confirmResumeParse(f.ctx, { ...f.confirmation, patch: { headline: 'Different content' } }))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await snapshotT01Profile(f.student.profileId)).toEqual(afterFirst)
    expect(await testDb.auditLog.count({ where: { action: 'resume.parse.confirm', actorId: f.student.userId } })).toBe(1)
  })

  it('two drafts based on one profile revision cannot both overwrite the profile', async () => {
    const f = await readyT01Fixture()
    const second = await readyT01Resume(f.student)
    const results = await Promise.allSettled([
      confirmResumeParse(f.ctx, { ...f.confirmation, patch: { headline: 'First candidate' } }),
      confirmResumeParse(f.ctx, {
        resumeId: second.resume.id, generation: second.draft.generation,
        expectedProfileRevision: f.profile.editRevision, patch: { headline: 'Second candidate' },
      }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason.code).toBe('CONFLICT')
    const drafts = await testDb.resumeParseDraft.findMany({ where: { resumeId: { in: [f.resume.id, second.resume.id] } } })
    expect(drafts.filter(d => d.state === 'CONFIRMED')).toHaveLength(1)
    expect(drafts.filter(d => d.state === 'READY' && d.payload !== null)).toHaveLength(1)
    expect((await snapshotT01Profile(f.student.profileId)).editRevision).toBe(f.profile.editRevision + 1)
  })

  it.each([1, 2, 3, 4])('manual step %s advances the revision exactly once and rejects a stale confirmation', async step => {
    const f = await readyT01Fixture()
    if (step === 1) await saveStep1(f.ctx, { fullName: 'Manually edited', workAuth: 'STUDENT_PASS' }, { advance: false })
    else if (step === 2) await saveStep2(f.ctx, { intents: ['INTERNSHIP'] }, { advance: false })
    else if (step === 3) await saveStep3(f.ctx, { skills: ['Manual skill'], languages: [{ language: 'English', level: 'NATIVE' }] }, { advance: false })
    else await saveStep4(f.ctx, { educations: [{ schoolName: 'Manual school' }], experiences: [] }, { advance: false })
    const saved = await snapshotT01Profile(f.student.profileId)
    expect(saved.editRevision).toBe(f.profile.editRevision + 1)
    await expect(confirmResumeParse(f.ctx, { ...f.confirmation, patch: { headline: 'Stale draft' } }))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await snapshotT01Profile(f.student.profileId)).toEqual(saved)
    await recalcOwnCompleteness(f.ctx)
    expect((await snapshotT01Profile(f.student.profileId)).editRevision).toBe(saved.editRevision)
  })

  it.each(['generation', 'source', 'epoch'] as const)('rejects changed %s without profile writes', async change => {
    const f = await readyT01Fixture()
    const before = await snapshotT01Profile(f.student.profileId)
    if (change === 'generation') {
      await discardResumeParseDraft(f.ctx, { resumeId: f.resume.id, generation: f.draft.generation })
    } else if (change === 'source') {
      await testDb.resumeFile.update({ where: { id: f.resume.id }, data: { contentSha256: 'f'.repeat(64) } })
    } else {
      await getSetting('ai.resumeParse', null)
      // Simulates a setting committed by a different process with this process's cache still warm.
      await testDb.systemSetting.update({ where: { key: 'ai.resumeParse' }, data: { value: {
        enabled: true, legalVersion: T01_VERSION, epoch: randomUUID(),
      } } })
    }
    await expect(confirmResumeParse(f.ctx, { ...f.confirmation, patch: { headline: 'Invalidated result' } })).rejects.toBeInstanceOf(AppError)
    expect(await snapshotT01Profile(f.student.profileId)).toEqual(before)
  })
})

describe('M9-T01 consent lifecycle', () => {
  it('duplicate grant keeps its identity; revoke/regrant advances time and never revives the old draft', async () => {
    const f = await readyT01Fixture()
    const before = await testDb.consent.findMany({ where: { userId: f.student.userId, type: 'AI_RESUME_PARSE' } })
    expect(before).toHaveLength(1)
    await setResumeParseConsent(f.ctx, { granted: true, submittedVersion: T01_VERSION })
    expect(await testDb.consent.findMany({ where: { userId: f.student.userId, type: 'AI_RESUME_PARSE' } })).toEqual(before)
    await setResumeParseConsent(f.ctx, { granted: false, submittedVersion: T01_VERSION })
    await setResumeParseConsent(f.ctx, { granted: true, submittedVersion: T01_VERSION })
    const history = await testDb.consent.findMany({ where: { userId: f.student.userId, type: 'AI_RESUME_PARSE' }, orderBy: { createdAt: 'asc' } })
    expect(history.map(c => c.granted)).toEqual([true, false, true])
    expect(history[2].id).not.toBe(history[0].id)
    expect(history[1].createdAt.getTime()).toBeGreaterThan(history[0].createdAt.getTime())
    expect(history[2].createdAt.getTime()).toBeGreaterThan(history[1].createdAt.getTime())
    const draft = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
    expect(draft.state).toBe('CANCELLED')
    expect(draft.generation).toBe(f.draft.generation + 1)
    expect(draft.payload).toBeNull()
    await expect(confirmResumeParse(f.ctx, { ...f.confirmation, patch: { headline: 'Old grant result' } }))
      .rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('revocation remains available with the gate off and atomically clears every pending draft', async () => {
    await seedT01Gate()
    const student = await seedT01Student()
    const ready = await readyT01Resume(student)
    const queued = await seedT01Resume(student)
    const processing = await seedT01Resume(student)
    for (const resume of [queued, processing]) await requestResumeParse({ userId: student.userId }, { resumeId: resume.id })
    await testDb.resumeParseDraft.update({ where: { resumeId: processing.id }, data: {
      state: 'PROCESSING', attempts: 1, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000),
    } })
    const before = await testDb.resumeParseDraft.findMany({ where: { resume: { studentId: student.profileId } } })
    expect(before.map(d => d.state).sort()).toEqual(['PROCESSING', 'QUEUED', 'READY'])
    await testDb.systemSetting.update({ where: { key: 'ai.resumeParse' }, data: { value: { enabled: false, legalVersion: null, epoch: randomUUID() } } })
    await setResumeParseConsent({ userId: student.userId }, { granted: false, submittedVersion: T01_VERSION })
    const after = await testDb.resumeParseDraft.findMany({ where: { resume: { studentId: student.profileId } } })
    expect(after).toHaveLength(3)
    for (const draft of after) {
      expect(draft.state).toBe('CANCELLED')
      expect(draft.generation).toBe(before.find(d => d.id === draft.id)!.generation + 1)
      expect(draft.payload).toBeNull()
      expect(draft.leaseToken).toBeNull()
      expect(draft.leaseExpiresAt).toBeNull()
    }
    expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: ready.resume.id } })).parsedJson)
      .toEqual({ legacy: 'untouched-legacy' })
  })

  it('generic consent recording cannot mint an AI grant', async () => {
    await seedT01Gate()
    const student = await createStudent(testDb)
    await expect(recordConsents(student.userId, [{ type: 'AI_RESUME_PARSE', granted: true }], {})).rejects.toBeInstanceOf(AppError)
    expect(await testDb.consent.count({ where: { userId: student.userId, type: 'AI_RESUME_PARSE' } })).toBe(0)
  })
})
