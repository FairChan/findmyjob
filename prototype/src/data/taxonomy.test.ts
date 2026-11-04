import { describe, it, expect } from 'vitest'
import { industryMatches, industryName, LANDMARKS } from './taxonomy'
import { COMPANIES, JOBS } from './mock'

describe('taxonomy', () => {
  it('industryMatches parent and exact codes', () => {
    expect(industryMatches('finance.bank', 'finance')).toBe(true)
    expect(industryMatches('finance.bank', 'finance.bank')).toBe(true)
    expect(industryMatches('healthcare.vet', 'finance')).toBe(false)
    expect(industryMatches('finance', 'finance.bank')).toBe(false)
    expect(industryMatches('finance.bank', 'fin')).toBe(false)
  })
  it('every mock company uses a known industry code', () => {
    for (const c of COMPANIES) expect(industryName(c.industryCode)).not.toBe(c.industryCode)
  })
  it('every mock job and landmark sits inside Malaysia', () => {
    for (const p of [...JOBS, ...LANDMARKS]) {
      expect(p.lat).toBeGreaterThan(0.8); expect(p.lat).toBeLessThan(7.5)
      expect(p.lng).toBeGreaterThan(99.5); expect(p.lng).toBeLessThan(119.5)
    }
  })
})
