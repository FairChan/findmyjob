import { describe, expect, it } from 'vitest'
import { embeddingVectorSchema, matchingConsentSchema, matchingGateInputSchema, matchingGateSchema, MATCHING_CONFIGURATION_ID, recommendJobsSchema, recommendTalentsSchema } from '@/schemas/semantic-matching'
const gate = { enabled: false, legalVersion: null, epoch: '00000000-0000-4000-8000-000000000000', configurationId: MATCHING_CONFIGURATION_ID }
describe('pure matching schema shared by provider, service and actions', () => {
  it('does not accept missing/invalid persisted gate as enabled', () => {
    for (const value of [null, {}, { ...gate, enabled: 'true' }, { ...gate, configurationId: 'unknown' }]) expect(matchingGateSchema.safeParse(value).success).toBe(false)
    expect(matchingGateSchema.parse(gate).enabled).toBe(false)
    expect(matchingGateInputSchema.safeParse(gate).success).toBe(false)
  })
  it('parses bounded recommendations and rejects client authorization/configuration fields', () => {
    expect(recommendJobsSchema.parse({})).toEqual({ limit: 10 })
    expect(recommendTalentsSchema.parse({ jobId: 'c' + '1'.repeat(24) })).toEqual({ jobId: 'c' + '1'.repeat(24), limit: 10 })
    for (const value of [{ limit: 0 }, { limit: 21 }, { limit: 1.5 }, { userId: 'other' }, { model: 'other' }]) expect(recommendJobsSchema.safeParse(value).success).toBe(false)
  })
  it('requires a version only for grants', () => {
    expect(matchingConsentSchema.safeParse({ granted: true }).success).toBe(false)
    expect(matchingConsentSchema.parse({ granted: false })).toEqual({ granted: false })
    expect(matchingConsentSchema.parse({ granted: false, submittedVersion: null })).toEqual({ granted: false, submittedVersion: null })
  })
  it('accepts only finite nonzero float32-representable 1024 vectors', () => {
    const valid = Array.from({ length: 1024 }, (_, index) => index === 0 ? 1 : 0)
    expect(embeddingVectorSchema.safeParse(valid).success).toBe(true)
    for (const value of [valid.slice(1), Array(1024).fill(0), [Number.MAX_VALUE, ...valid.slice(1)], [NaN, ...valid.slice(1)], [Infinity, ...valid.slice(1)], Array(1024).fill(1e-50)]) {
      expect(embeddingVectorSchema.safeParse(value).success).toBe(false)
    }
  })
})
