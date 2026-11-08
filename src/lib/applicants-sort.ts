import type { ApplicantRow } from '@/server/services/applicants'

export type SortKey = 'cgpa' | 'graduationYear' | 'completeness'

/**
 * Pure sort for the standardized applicant list.
 * - cgpa: descending, null last
 * - graduationYear: descending by year*100+month, null last
 * - completeness: descending
 */
export function sortApplicantRows(rows: ApplicantRow[], key: SortKey): ApplicantRow[] {
  return [...rows].sort((a, b) => {
    if (key === 'cgpa') {
      const av = a.card.cgpa !== null ? parseFloat(a.card.cgpa) : null
      const bv = b.card.cgpa !== null ? parseFloat(b.card.cgpa) : null
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return bv - av
    }
    if (key === 'graduationYear') {
      const av =
        a.card.graduationYear !== null
          ? a.card.graduationYear * 100 + (a.graduationMonth ?? 0)
          : null
      const bv =
        b.card.graduationYear !== null
          ? b.card.graduationYear * 100 + (b.graduationMonth ?? 0)
          : null
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return bv - av
    }
    return b.card.completeness - a.card.completeness
  })
}
