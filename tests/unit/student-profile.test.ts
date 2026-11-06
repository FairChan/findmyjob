/**
 * M2-T01: student-profile service unit tests
 * Tests schema validation and rough completeness logic without DB.
 */
import { describe, it, expect } from 'vitest'
import { step1Schema, step2Schema, step3Schema, step4Schema } from '@/server/services/student-profile'

describe('step1Schema', () => {
  it('requires fullName and workAuth', () => {
    const result = step1Schema.safeParse({ fullName: '', workAuth: '' })
    expect(result.success).toBe(false)
  })

  it('accepts minimal valid input', () => {
    const result = step1Schema.safeParse({ fullName: 'Alice', workAuth: 'STUDENT_PASS' })
    expect(result.success).toBe(true)
  })

  it('rejects cgpa < 0', () => {
    const result = step1Schema.safeParse({ fullName: 'Alice', workAuth: 'STUDENT_PASS', cgpa: -0.1 })
    expect(result.success).toBe(false)
  })

  it('rejects cgpa > 4', () => {
    const result = step1Schema.safeParse({ fullName: 'Alice', workAuth: 'STUDENT_PASS', cgpa: 4.01 })
    expect(result.success).toBe(false)
  })

  it('accepts cgpa at boundary values', () => {
    expect(step1Schema.safeParse({ fullName: 'Alice', workAuth: 'MY_CITIZEN', cgpa: 0 }).success).toBe(true)
    expect(step1Schema.safeParse({ fullName: 'Alice', workAuth: 'MY_CITIZEN', cgpa: 4.0 }).success).toBe(true)
  })

  it('accepts null cgpa', () => {
    const result = step1Schema.safeParse({ fullName: 'Alice', workAuth: 'MY_CITIZEN', cgpa: null })
    expect(result.success).toBe(true)
  })

  it('rejects invalid workAuth value', () => {
    const result = step1Schema.safeParse({ fullName: 'Alice', workAuth: 'INVALID' })
    expect(result.success).toBe(false)
  })

  it('accepts all valid workAuth values', () => {
    const values = ['MY_CITIZEN', 'MY_PR', 'STUDENT_PASS', 'DEPENDANT_PASS', 'NEEDS_WORK_PASS', 'OTHER']
    for (const v of values) {
      expect(step1Schema.safeParse({ fullName: 'Alice', workAuth: v }).success).toBe(true)
    }
  })

  it('rejects fullName longer than 100 chars', () => {
    const result = step1Schema.safeParse({ fullName: 'A'.repeat(101), workAuth: 'MY_CITIZEN' })
    expect(result.success).toBe(false)
  })

  it('uppercases nationality via transform', () => {
    const result = step1Schema.safeParse({ fullName: 'Alice', workAuth: 'MY_CITIZEN', nationality: 'cn' })
    expect(result.success).toBe(true)
    expect((result as { success: true; data: { nationality?: string } }).data?.nationality).toBe('CN')
  })
})

describe('step2Schema', () => {
  it('requires at least one intent', () => {
    const result = step2Schema.safeParse({ intents: [] })
    expect(result.success).toBe(false)
  })

  it('accepts valid intents', () => {
    const result = step2Schema.safeParse({ intents: ['INTERNSHIP', 'FULL_TIME'] })
    expect(result.success).toBe(true)
  })

  it('rejects invalid intent value', () => {
    const result = step2Schema.safeParse({ intents: ['INVALID'] })
    expect(result.success).toBe(false)
  })

  it('accepts empty optional fields', () => {
    const result = step2Schema.safeParse({
      intents: ['PART_TIME'],
      preferredStates: [],
      preferredIndustries: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects negative salary', () => {
    const result = step2Schema.safeParse({ intents: ['INTERNSHIP'], expectedSalaryMin: -100 })
    expect(result.success).toBe(false)
  })
})

describe('step3Schema', () => {
  it('accepts empty arrays', () => {
    const result = step3Schema.safeParse({ languages: [], skills: [] })
    expect(result.success).toBe(true)
  })

  it('rejects skill longer than 50 chars', () => {
    const result = step3Schema.safeParse({ languages: [], skills: ['A'.repeat(51)] })
    expect(result.success).toBe(false)
  })

  it('rejects more than 30 skills', () => {
    const result = step3Schema.safeParse({ languages: [], skills: Array.from({ length: 31 }, (_, i) => `skill${i}`) })
    expect(result.success).toBe(false)
  })

  it('rejects invalid language level', () => {
    const result = step3Schema.safeParse({
      languages: [{ language: 'zh', level: 'INVALID' }],
      skills: [],
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid language levels', () => {
    const levels = ['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE']
    for (const level of levels) {
      const result = step3Schema.safeParse({ languages: [{ language: 'zh', level }], skills: [] })
      expect(result.success).toBe(true)
    }
  })

  it('rejects headline longer than 100 chars', () => {
    const result = step3Schema.safeParse({ languages: [], skills: [], headline: 'A'.repeat(101) })
    expect(result.success).toBe(false)
  })
})

describe('step4Schema', () => {
  it('accepts empty arrays (all optional)', () => {
    const result = step4Schema.safeParse({ educations: [], experiences: [] })
    expect(result.success).toBe(true)
  })

  it('requires schoolName for education entry', () => {
    const result = step4Schema.safeParse({
      educations: [{ schoolName: '', degreeLevel: 'BACHELOR' }],
      experiences: [],
    })
    expect(result.success).toBe(false)
  })

  it('requires title for experience entry', () => {
    const result = step4Schema.safeParse({
      educations: [],
      experiences: [{ kind: 'INTERNSHIP', title: '' }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid education entry', () => {
    const result = step4Schema.safeParse({
      educations: [{ schoolName: 'XMUM', degreeLevel: 'BACHELOR', major: 'CS' }],
      experiences: [],
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid experience kind', () => {
    const result = step4Schema.safeParse({
      educations: [],
      experiences: [{ kind: 'INVALID', title: 'Developer Intern' }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid experience kinds', () => {
    const kinds = ['INTERNSHIP', 'WORK', 'PROJECT', 'CAMPUS', 'AWARD']
    for (const kind of kinds) {
      const result = step4Schema.safeParse({
        educations: [],
        experiences: [{ kind, title: 'Test' }],
      })
      expect(result.success).toBe(true)
    }
  })
})
