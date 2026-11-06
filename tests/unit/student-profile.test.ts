/**
 * M2-T01/M2-T08/M2-T11: student-profile service unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/env', () => ({ env: {} }))

const mockTx = vi.hoisted(() => ({
  studentProfile: { findUnique: vi.fn(), update: vi.fn() },
  studentLanguage: { count: vi.fn().mockResolvedValue(0), deleteMany: vi.fn(), createMany: vi.fn() },
  education: { count: vi.fn().mockResolvedValue(0) },
  experience: { count: vi.fn().mockResolvedValue(0) },
  resumeFile: { count: vi.fn().mockResolvedValue(0) },
  studentContact: { findUnique: vi.fn().mockResolvedValue(null) },
  school: { findFirst: vi.fn() },
}))

const mockDb = vi.hoisted(() => ({
  studentProfile: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/server/db', () => ({ db: mockDb }))
vi.mock('@/server/services/referrals', () => ({ qualifyReferral: vi.fn() }))

import { step1Schema, step2Schema, step3Schema, step4Schema, getDashboardData, recalcOwnCompleteness, saveStep1 } from '@/server/services/student-profile'
import { ValidationError } from '@/server/errors'

const mockHasStudentContact = vi.hoisted(() => vi.fn())
const mockHasStudentContactTx = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/contact-access', () => ({
  hasStudentContact: mockHasStudentContact,
  hasStudentContactTx: mockHasStudentContactTx,
}))

describe('getDashboardData', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns null when profile does not exist', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue(null)
    const result = await getDashboardData({ userId: 'user1' })
    expect(result).toBeNull()
  })

  it('returns all false flags for a bare profile', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue({
      id: 'sp1',
      completeness: 0,
      schoolVerifiedAt: null,
      visibility: 'HIDDEN',
      _count: { resumes: 0 },
    })
    mockHasStudentContact.mockResolvedValue(false)

    const result = await getDashboardData({ userId: 'user1' })
    expect(result).toMatchObject({
      completeness: 0,
      schoolVerifiedAt: null,
      hasResume: false,
      hasContact: false,
      talentPoolEnabled: false,
    })
  })

  it('reflects verified school, resume, contact, and talent pool', async () => {
    const verifiedAt = new Date('2026-01-01T00:00:00Z')
    mockDb.studentProfile.findUnique.mockResolvedValue({
      id: 'sp2',
      completeness: 100,
      schoolVerifiedAt: verifiedAt,
      visibility: 'PUBLIC',
      _count: { resumes: 1 },
    })
    mockHasStudentContact.mockResolvedValue(true)

    const result = await getDashboardData({ userId: 'user2' })
    expect(result).toMatchObject({
      completeness: 100,
      schoolVerifiedAt: verifiedAt,
      hasResume: true,
      hasContact: true,
      talentPoolEnabled: true,
    })
  })
})

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

// M2-T11 fix 1: schoolId schema change (cuid → min(1).max(64))
describe('step1Schema — schoolId validation (M2-T11)', () => {
  it('accepts non-cuid school ID like "school-xmum"', () => {
    const result = step1Schema.safeParse({ fullName: 'Alice', workAuth: 'STUDENT_PASS', schoolId: 'school-xmum' })
    expect(result.success).toBe(true)
  })

  it('rejects empty string as schoolId', () => {
    const result = step1Schema.safeParse({ fullName: 'Alice', workAuth: 'STUDENT_PASS', schoolId: '' })
    expect(result.success).toBe(false)
  })

  it('rejects schoolId longer than 64 chars', () => {
    const result = step1Schema.safeParse({ fullName: 'Alice', workAuth: 'STUDENT_PASS', schoolId: 'a'.repeat(65) })
    expect(result.success).toBe(false)
  })

  it('accepts null schoolId (optional)', () => {
    const result = step1Schema.safeParse({ fullName: 'Alice', workAuth: 'STUDENT_PASS', schoolId: null })
    expect(result.success).toBe(true)
  })
})

// M2-T11 fix 1: server-side school existence validation
describe('saveStep1 — school validation (M2-T11)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx))
    // First call: saveStep1 fetches id+onboardingStep; second call: recalcCompleteness fetches workAuth+intents+…
    mockTx.studentProfile.findUnique
      .mockResolvedValueOnce({ id: 'sp1', onboardingStep: 1 })
      .mockResolvedValueOnce({ workAuth: 'STUDENT_PASS', intents: ['INTERNSHIP'], skills: [], headline: null, summary: null })
    mockTx.studentProfile.update.mockResolvedValue({})
    mockHasStudentContactTx.mockResolvedValue(false)
    mockTx.studentLanguage.count.mockResolvedValue(0)
    mockTx.education.count.mockResolvedValue(0)
    mockTx.experience.count.mockResolvedValue(0)
    mockTx.resumeFile.count.mockResolvedValue(0)
  })

  it('succeeds when schoolId is valid and active', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue({ id: 'sp1', onboardingStep: 1 })
    mockTx.school.findFirst.mockResolvedValue({ id: 'school-xmum' })
    await expect(
      saveStep1({ userId: 'user1' }, { fullName: 'Alice', workAuth: 'STUDENT_PASS', schoolId: 'school-xmum' }),
    ).resolves.not.toThrow()
  })

  it('throws ValidationError when schoolId does not exist', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue({ id: 'sp1', onboardingStep: 1 })
    mockTx.school.findFirst.mockResolvedValue(null)
    await expect(
      saveStep1({ userId: 'user1' }, { fullName: 'Alice', workAuth: 'STUDENT_PASS', schoolId: 'nonexistent' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('skips school check when schoolId is omitted', async () => {
    mockDb.studentProfile.findUnique.mockResolvedValue({ id: 'sp1', onboardingStep: 1 })
    await expect(
      saveStep1({ userId: 'user1' }, { fullName: 'Alice', workAuth: 'STUDENT_PASS' }),
    ).resolves.not.toThrow()
    expect(mockTx.school.findFirst).not.toHaveBeenCalled()
  })
})

// M2-T11 fix 4: recalcOwnCompleteness updates completeness after contact save
describe('recalcOwnCompleteness (M2-T11)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx))
  })

  it('recalculates completeness to 90 when contact is added to an 85-score profile', async () => {
    // Profile: workAuth(30) + intents(15) + skills(20) + edu/exp(20) = 85, no PDF, no contact
    mockDb.studentProfile.findUnique.mockResolvedValue({ id: 'sp1' })
    mockTx.studentProfile.findUnique.mockResolvedValue({
      workAuth: 'STUDENT_PASS',
      intents: ['INTERNSHIP'],
      skills: ['React'],
      headline: null,
      summary: null,
    })
    mockTx.studentLanguage.count.mockResolvedValue(0)
    mockTx.education.count.mockResolvedValue(1)
    mockTx.experience.count.mockResolvedValue(0)
    mockTx.resumeFile.count.mockResolvedValue(0)
    // Contact row now exists with a phone — hasStudentContactTx returns true
    mockHasStudentContactTx.mockResolvedValue(true)
    mockTx.studentProfile.update.mockResolvedValue({})

    await recalcOwnCompleteness({ userId: 'user1' })

    expect(mockTx.studentProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { completeness: 90 } }),
    )
  })
})
