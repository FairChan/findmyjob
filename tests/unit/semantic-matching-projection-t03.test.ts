import { describe, expect, it } from 'vitest'
import { buildJobMatchingText, buildStudentMatchingText } from '@/server/lib/matching-text'
import { embeddingVectorSchema } from '@/schemas/semantic-matching'

describe('M9-T03 stable minimized text and storage-safe vectors', () => {
  it('normalizes case-insensitive set ordering before hashing', () => {
    const input = { title: 'Engineer', type: 'INTERNSHIP' as const, category: null, workMode: 'HYBRID' as const,
      state: null, city: null, skills: [' TypeScript ', 'SQL', 'typescript'], languages: ['English', 'Malay'] }
    expect(buildJobMatchingText(input)).toEqual(buildJobMatchingText({ ...input, skills: ['sql', 'typescript'], languages: ['malay', 'ENGLISH'] }))
  })
  it('does not embed marker-only student content', () => {
    expect(buildStudentMatchingText({ fullName: 'Private Name', headline: 'Private Name', major: 'alice@example.com',
      degreeLevel: null, skills: ['alice@example.com'], intents: [], preferredStates: [] })).toBeNull()
  })
  it.each([1e100, 1e-100])('rejects a finite vector that becomes overflow/zero in float32: %s', value => {
    expect(embeddingVectorSchema.safeParse([value, ...Array<number>(1023).fill(0)]).success).toBe(false)
  })
})
