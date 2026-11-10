import { describe, expect, it } from 'vitest'
import { toTalentDetail } from '@/server/serializers/talent-card'
import type { ProfileDetailInput } from '@/server/serializers/talent-card'

const LEGACY = 'legacy-private-parse@example.test'
const DRAFT = 'private-ready-draft@example.test'
const KEY = 'resumes/synthetic-student/private.pdf'

function profile(isPrimary: boolean): ProfileDetailInput {
  // A variable preserves the regression fixture after parsedJson leaves ResumeInput.
  const resumes = [{
    id: 'synthetic-resume', storageKey: KEY, isPrimary,
    parsedJson: { summary: LEGACY, nested: { email: LEGACY } },
    parseDraft: { state: 'READY', payload: { summary: DRAFT } },
  }]
  return {
    id: 'synthetic-student', fullName: 'Synthetic Student',
    headline: 'Approved headline', summary: 'Approved summary', skills: ['TypeScript'],
    major: null, degreeLevel: null, graduationYear: null, cgpa: null, workAuth: null,
    completeness: 80, visibility: 'PUBLIC', school: null,
    educations: [], experiences: [], resumes,
  }
}

describe('M9-T01 employer serializer never exposes resume parsing data', () => {
  it.each([
    { unlocked: false, primary: false },
    { unlocked: false, primary: true },
    { unlocked: true, primary: false },
    { unlocked: true, primary: true },
  ])('withholds private JSON for $unlocked / primary=$primary', ({ unlocked, primary }) => {
    const result = toTalentDetail(profile(primary), { unlocked })
    expect(result.resumePreview).toBeNull()
    expect(result.resumeCount).toBe(1)
    expect(result.resumeIds).toEqual(unlocked ? ['synthetic-resume'] : [])
    const json = JSON.stringify(result)
    for (const value of [LEGACY, DRAFT, KEY, 'parsedJson', 'parseDraft']) {
      expect(json).not.toContain(value)
    }
  })

  it.each([false, true])('does not read private properties when unlocked=%s', unlocked => {
    const value = profile(true)
    for (const name of ['parsedJson', 'parseDraft']) {
      Object.defineProperty(value.resumes[0], name, {
        get() { throw new Error('Private parsing property must not be inspected') },
      })
    }
    expect(toTalentDetail(value, { unlocked }).resumePreview).toBeNull()
  })

  it('keeps confirmed profile fields available through the existing projection', () => {
    const result = toTalentDetail(profile(true), { unlocked: true })
    expect(result.headline).toBe('Approved headline')
    expect(result.summary).toBe('Approved summary')
    expect(result.skills).toEqual(['TypeScript'])
    expect(result.resumePreview).toBeNull()
  })
})
