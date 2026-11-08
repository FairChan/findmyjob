/**
 * Unit tests for sortApplicantRows (M5-T14, item 2).
 * Covers: three sort keys, null values last, same year / different month.
 */
import { describe, it, expect } from 'vitest'
import { sortApplicantRows } from '@/lib/applicants-sort'
import type { ApplicantRow } from '@/server/services/applicants'
import type { TalentCard } from '@/server/serializers/talent-card'

function makeCard(overrides: Partial<TalentCard> = {}): TalentCard {
  return {
    id: 'cuid-test',
    name: 'Test',
    unlocked: false,
    school: null,
    major: null,
    degreeLevel: null,
    graduationYear: null,
    cgpa: null,
    skills: [],
    headline: null,
    completeness: 0,
    workAuth: null,
    lastActiveAt: null,
    ...overrides,
  }
}

function makeRow(overrides: Partial<ApplicantRow> = {}): ApplicantRow {
  return {
    applicationId: `app-${Math.random()}`,
    studentId: `stu-${Math.random()}`,
    status: 'APPLIED',
    coverNote: null,
    companyNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    card: makeCard(),
    graduationMonth: null,
    languages: [],
    internshipCount: 0,
    campusCount: 0,
    ...overrides,
  }
}

// ---- CGPA sort ----

describe('sortApplicantRows: cgpa', () => {
  it('sorts descending — higher CGPA first', () => {
    const rows = [
      makeRow({ card: makeCard({ cgpa: '3.20', completeness: 0 }) }),
      makeRow({ card: makeCard({ cgpa: '3.80', completeness: 0 }) }),
      makeRow({ card: makeCard({ cgpa: '2.90', completeness: 0 }) }),
    ]
    const sorted = sortApplicantRows(rows, 'cgpa')
    expect(sorted.map((r) => r.card.cgpa)).toEqual(['3.80', '3.20', '2.90'])
  })

  it('null CGPA sorts last', () => {
    const rows = [
      makeRow({ card: makeCard({ cgpa: null, completeness: 0 }) }),
      makeRow({ card: makeCard({ cgpa: '3.50', completeness: 0 }) }),
      makeRow({ card: makeCard({ cgpa: null, completeness: 0 }) }),
    ]
    const sorted = sortApplicantRows(rows, 'cgpa')
    expect(sorted[0].card.cgpa).toBe('3.50')
    expect(sorted[1].card.cgpa).toBeNull()
    expect(sorted[2].card.cgpa).toBeNull()
  })

  it('two null CGPAs preserve stable relative order', () => {
    const a = makeRow({ card: makeCard({ cgpa: null }) })
    const b = makeRow({ card: makeCard({ cgpa: null }) })
    const sorted = sortApplicantRows([a, b], 'cgpa')
    expect(sorted).toHaveLength(2)
  })
})

// ---- Graduation year/month sort ----

describe('sortApplicantRows: graduationYear', () => {
  it('sorts descending — more recent graduation first', () => {
    const rows = [
      makeRow({ card: makeCard({ graduationYear: 2024 }), graduationMonth: null }),
      makeRow({ card: makeCard({ graduationYear: 2026 }), graduationMonth: null }),
      makeRow({ card: makeCard({ graduationYear: 2025 }), graduationMonth: null }),
    ]
    const sorted = sortApplicantRows(rows, 'graduationYear')
    expect(sorted.map((r) => r.card.graduationYear)).toEqual([2026, 2025, 2024])
  })

  it('same year — later month sorts first (year*100+month)', () => {
    const rows = [
      makeRow({ card: makeCard({ graduationYear: 2025 }), graduationMonth: 3 }),
      makeRow({ card: makeCard({ graduationYear: 2025 }), graduationMonth: 11 }),
      makeRow({ card: makeCard({ graduationYear: 2025 }), graduationMonth: 6 }),
    ]
    const sorted = sortApplicantRows(rows, 'graduationYear')
    expect(sorted.map((r) => r.graduationMonth)).toEqual([11, 6, 3])
  })

  it('null graduationYear sorts last', () => {
    const rows = [
      makeRow({ card: makeCard({ graduationYear: null }), graduationMonth: null }),
      makeRow({ card: makeCard({ graduationYear: 2025 }), graduationMonth: 6 }),
      makeRow({ card: makeCard({ graduationYear: null }), graduationMonth: null }),
    ]
    const sorted = sortApplicantRows(rows, 'graduationYear')
    expect(sorted[0].card.graduationYear).toBe(2025)
    expect(sorted[1].card.graduationYear).toBeNull()
    expect(sorted[2].card.graduationYear).toBeNull()
  })

  it('null month treated as 0 (earlier in year)', () => {
    const rows = [
      makeRow({ card: makeCard({ graduationYear: 2025 }), graduationMonth: null }),
      makeRow({ card: makeCard({ graduationYear: 2025 }), graduationMonth: 1 }),
    ]
    const sorted = sortApplicantRows(rows, 'graduationYear')
    // month=1 → 202501 > 202500, so 1 comes first
    expect(sorted[0].graduationMonth).toBe(1)
    expect(sorted[1].graduationMonth).toBeNull()
  })
})

// ---- Completeness sort ----

describe('sortApplicantRows: completeness', () => {
  it('sorts descending — higher completeness first', () => {
    const rows = [
      makeRow({ card: makeCard({ completeness: 40 }) }),
      makeRow({ card: makeCard({ completeness: 90 }) }),
      makeRow({ card: makeCard({ completeness: 70 }) }),
    ]
    const sorted = sortApplicantRows(rows, 'completeness')
    expect(sorted.map((r) => r.card.completeness)).toEqual([90, 70, 40])
  })

  it('equal completeness — relative order unchanged (stable)', () => {
    const a = makeRow({ card: makeCard({ completeness: 60 }) })
    const b = makeRow({ card: makeCard({ completeness: 60 }) })
    const sorted = sortApplicantRows([a, b], 'completeness')
    expect(sorted).toHaveLength(2)
  })
})
