import { describe, expect, it } from 'vitest'
import { buildStudentMatchingText, buildJobMatchingText } from '@/server/lib/matching-text'
import { embeddingVectorSchema, recommendJobsSchema, recommendTalentsSchema } from '@/schemas/semantic-matching'

const student = {
  fullName: 'PRIVATE Fullname Sentinel', headline: 'PRIVATE Fullname Sentinel builds TypeScript', major: 'Computing',
  degreeLevel: 'BACHELOR' as const, skills: ['TypeScript', 'private-contact@example.test'],
  intents: ['INTERNSHIP' as const], preferredStates: ['KUL'],
}
const job = {
  title: 'TypeScript developer', type: 'INTERNSHIP' as const, category: 'technology', workMode: 'HYBRID' as const,
  state: 'KUL', city: 'Kuala Lumpur', skills: ['TypeScript'], languages: ['English'],
}

describe('M9-T03 public-career projection and strict inputs', () => {
  it('student projection excludes identity/contact and ignores private draft/document fields', () => {
    const input = {
      ...student, summary: 'PRIVATE_SUMMARY_SENTINEL', resumes: [{ parsedJson: 'PRIVATE_DRAFT_SENTINEL' }],
      contact: { phone: '+60123456789' }, sourceStorageKey: 'private/key.pdf', cgpa: '4.00', nationality: 'PRIVATE_NATIONALITY',
    }
    const result = buildStudentMatchingText(input)
    expect(result?.text).toContain('TypeScript')
    for (const secret of [student.fullName, 'private-contact@example.test', 'PRIVATE_SUMMARY_SENTINEL', 'PRIVATE_DRAFT_SENTINEL', '+60123456789', 'private/key.pdf', 'PRIVATE_NATIONALITY']) {
      expect(result?.text).not.toContain(secret)
    }
    expect(result?.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    const changedPrivateInput = { ...input, summary: 'DIFFERENT_PRIVATE_TEXT' }
    expect(buildStudentMatchingText(changedPrivateInput)).toEqual(result)
  })

  it('job ranking is invariant to locked bodies, review notes, and all salary fields', () => {
    const a = { ...job, description: 'PRIVATE_BODY_A', requirements: 'PRIVATE_REQUIREMENT', benefits: 'PRIVATE_BENEFIT', salaryVisible: false, salaryMax: 9000, reviewNote: 'PRIVATE_REVIEW' }
    const b = { ...a, description: 'PRIVATE_BODY_B', requirements: 'DIFFERENT', salaryVisible: true, salaryMax: 3000 }
    expect(buildJobMatchingText(a)).toEqual(buildJobMatchingText(b))
    expect(buildJobMatchingText(a).text).toContain('TypeScript')
    expect(buildJobMatchingText(a).text).not.toMatch(/PRIVATE_|9000|3000/)
  })

  it('an actual public career edit changes the source hash', () => {
    expect(buildJobMatchingText({ ...job, skills: ['Accounting'] }).sourceHash).not.toBe(buildJobMatchingText(job).sourceHash)
    expect(buildStudentMatchingText({ ...student, major: 'Accounting' })?.sourceHash).not.toBe(buildStudentMatchingText(student)?.sourceHash)
  })

  it('rejects oversized text instead of silently truncating', () => {
    expect(() => buildJobMatchingText({ ...job, title: 'x'.repeat(8_001) })).toThrow()
  })

  it.each([1023, 1025])('rejects vector dimension %s', length => {
    expect(embeddingVectorSchema.safeParse(Array<number>(length).fill(0.1)).success).toBe(false)
  })
  it.each([NaN, Infinity, -Infinity])('rejects nonfinite vector component %s', value => {
    expect(embeddingVectorSchema.safeParse([value, ...Array<number>(1023).fill(0.1)]).success).toBe(false)
  })
  it('rejects zero norm and accepts a valid nonzero 1024-vector', () => {
    expect(embeddingVectorSchema.safeParse(Array<number>(1024).fill(0)).success).toBe(false)
    expect(embeddingVectorSchema.safeParse([1, ...Array<number>(1023).fill(0)]).success).toBe(true)
  })
  it.each([{ limit: 0 }, { limit: 21 }, { limit: 1.5 }, { userId: 'foreign' }, { vector: [1] }, { query: 'contact@example.test' }])('rejects unbounded or actor-authored input %j', input => {
    expect(recommendJobsSchema.safeParse(input).success).toBe(false)
  })
  it('talent recommendations require a valid owned-source identifier, not an SQL expression', () => {
    expect(recommendTalentsSchema.safeParse({ jobId: "x' OR 1=1 --" }).success).toBe(false)
    expect(recommendTalentsSchema.safeParse({ jobId: 'c1234567890123456789012345', companyId: 'other' }).success).toBe(false)
    expect(recommendJobsSchema.parse({})).toEqual({ limit: 10 })
  })
})
