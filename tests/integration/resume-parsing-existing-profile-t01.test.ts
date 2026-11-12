import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/jobs/boss', () => ({ sendBoss: {
  start: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue('synthetic-job'),
} }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: vi.fn(), deleteAllVersions: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/services/notify', () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/env', async original => {
  const actual = await original<typeof import('@/env')>()
  return { ...actual, env: { ...actual.env, ANTHROPIC_API_KEY: 'synthetic-key', AI_MODEL_PARSE: 'synthetic-model' } }
})

import { setupTestDb, testDb } from '../setup/db'
import { readyT01Fixture, snapshotT01Profile, T01_SUGGESTION } from '../helpers/resume-parsing-t01'
import { getResumeParseDraft, confirmResumeParse } from '@/server/services/resume-parsing'
import { saveStep3, saveStep4, step3Schema, step4Schema } from '@/server/services/student-profile'
import { normalizeResumeSuggestion } from '@/server/schemas/resume-parsing'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(() => { vi.clearAllMocks(); clearSettingsCache() })

const historicalLanguages = [
  { language: 'English', level: 'FLUENT' as const },
  { language: 'english', level: 'BASIC' as const },
]
const historicalExperience = {
  kind: 'WORK' as const, title: 'Existing manual role', organization: 'Existing company',
  startDate: '2025-06-01T00:00:00.000Z', endDate: '2024-06-01T00:00:00.000Z', description: 'Existing manual description',
}
const historicalEducation = {
  schoolName: 'Existing manual school', degreeLevel: 'BACHELOR' as const, major: 'Computing',
  startDate: '2024-09-01T00:00:00.000Z', endDate: '2023-09-01T00:00:00.000Z', gpa: null, description: null,
}

describe('T01 existing manual profile is not an AI candidate', () => {
  it.each(['reversed-dates', 'case-variant-languages', 'both'] as const)(
    'reads a valid READY draft over %s and changes only the explicitly confirmed headline', async shape => {
      const f = await readyT01Fixture()
      // Use the real existing manual validators and services, not raw DB writes to invent an invalid state.
      await saveStep3(f.ctx, step3Schema.parse({
        languages: shape === 'reversed-dates' ? [{ language: 'English', level: 'FLUENT' }] : historicalLanguages,
        skills: ['Existing skill', 'existing skill'], headline: 'Existing manual headline', summary: 'Existing manual summary',
      }), { advance: false })
      await saveStep4(f.ctx, step4Schema.parse({
        educations: shape === 'case-variant-languages' ? [] : [historicalEducation],
        experiences: shape === 'case-variant-languages' ? [] : [historicalExperience],
      }), { advance: false })
      const before = await snapshotT01Profile(f.student.profileId)
      const draftBefore = await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })
      const resumeBefore = await testDb.resumeFile.findUniqueOrThrow({ where: { id: f.resume.id } })
      const dto = await getResumeParseDraft(f.ctx, { resumeId: f.resume.id })
      expect(dto).toMatchObject({ state: 'READY', payload: T01_SUGGESTION, profileRevision: before.editRevision })
      expect(dto!.currentProfile!.skills).toEqual(before.skills)
      expect(dto!.currentProfile!.languages).toHaveLength(before.languages.length)
      expect(dto!.currentProfile!.languages).toEqual(expect.arrayContaining(before.languages.map(({ language, level }) => ({ language, level }))))
      expect(dto!.currentProfile!.experiences).toEqual(shape === 'case-variant-languages' ? [] : [historicalExperience])
      expect(dto!.currentProfile!.educations).toEqual(shape === 'case-variant-languages' ? [] : [historicalEducation])
      expect(await snapshotT01Profile(f.student.profileId)).toEqual(before)
      expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).toEqual(draftBefore)

      await confirmResumeParse(f.ctx, {
        resumeId: f.resume.id, generation: dto!.generation, expectedProfileRevision: dto!.profileRevision,
        patch: { headline: 'Explicitly accepted new headline' },
      })
      const after = await snapshotT01Profile(f.student.profileId)
      expect(after.headline).toBe('Explicitly accepted new headline')
      expect(after.editRevision).toBe(before.editRevision + 1)
      for (const key of ['languages', 'educations', 'experiences', 'skills', 'summary', 'fullName', 'schoolId', 'schoolVerifiedAt', 'visibility', 'onboardingStep'] as const) {
        expect(after[key]).toEqual(before[key])
      }
      expect((await testDb.resumeFile.findUniqueOrThrow({ where: { id: f.resume.id } })).parsedJson).toEqual(resumeBefore.parsedJson)
      expect(await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } }))
        .toMatchObject({ state: 'CONFIRMED', payload: null })
    },
  )

  it.each(['reversed-dates', 'case-variant-languages'] as const)(
    'still rejects %s in a new AI suggestion or explicitly selected confirmation group', async shape => {
      const f = await readyT01Fixture()
      const before = await snapshotT01Profile(f.student.profileId)
      const patch = shape === 'reversed-dates' ? { experiences: [historicalExperience] } : { languages: historicalLanguages }
      expect(() => normalizeResumeSuggestion({ ...T01_SUGGESTION, ...patch })).toThrow()
      await expect(confirmResumeParse(f.ctx, { ...f.confirmation, patch })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(await snapshotT01Profile(f.student.profileId)).toEqual(before)
      expect((await testDb.resumeParseDraft.findUniqueOrThrow({ where: { resumeId: f.resume.id } })).state).toBe('READY')
    },
  )

  it('reads an existing profile larger than the AI output budget without rewriting it', async () => {
    const f = await readyT01Fixture()
    await saveStep4(f.ctx, step4Schema.parse({ educations: [], experiences: Array.from({ length: 50 }, (_, i) => ({
      kind: 'PROJECT', title: `Existing project ${i}`, organization: null, startDate: null, endDate: null,
      description: '研'.repeat(1000),
    })) }), { advance: false })
    const before = await snapshotT01Profile(f.student.profileId)
    const dto = await getResumeParseDraft(f.ctx, { resumeId: f.resume.id })
    expect(dto?.state).toBe('READY')
    expect(dto?.currentProfile?.experiences).toHaveLength(50)
    expect(dto?.currentProfile?.experiences[0]?.description).toBe('研'.repeat(1000))
    expect(await snapshotT01Profile(f.student.profileId)).toEqual(before)
  })
})
