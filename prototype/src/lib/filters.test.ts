import { describe, it, expect } from 'vitest'
import { distanceKm, filterJobs, parseFilters, toParams, type JobFilters } from './filters'
import { LANDMARKS } from '../data/taxonomy'
import { fixtureCompany, fixtureJob } from '../test/fixtures'
import type { Company } from '../data/mock'

const companies: Record<string, Company> = {
  bank: fixtureCompany({ id: 'bank', industryCode: 'finance.bank', tags: ['SOE'] }),
  ins: fixtureCompany({ id: 'ins', industryCode: 'finance.insurance', tags: ['FORTUNE_500'] }),
  hosp: fixtureCompany({ id: 'hosp', industryCode: 'healthcare.hospital', tags: [] }),
}
const ctx = { companyById: (id: string) => companies[id], landmarks: LANDMARKS }
const ids = (f: JobFilters, jobs = all) => filterJobs(jobs, f, ctx).map((j) => j.id)

const all = [
  fixtureJob({ id: 'j-bank', companyId: 'bank', salaryMin: 2500, salaryMax: 3500, lat: 3.147, lng: 101.711 }),
  fixtureJob({ id: 'j-ins', companyId: 'ins', salaryMin: 2000, salaryMax: 2800, lat: 5.414, lng: 100.329 }),
  fixtureJob({ id: 'j-hosp', companyId: 'hosp', salaryMin: 6000, salaryMax: 9000, salaryHidden: true }),
]

describe('filters', () => {
  it('distanceKm KLCC to Bukit Bintang is about 1.27 km', () => {
    const d = distanceKm({ lat: 3.1579, lng: 101.7123 }, { lat: 3.1466, lng: 101.7108 })
    expect(d).toBeGreaterThan(1.2)
    expect(d).toBeLessThan(1.35)
  })
  it('industry parent code includes its children', () => {
    expect(ids({ industry: 'finance' })).toEqual(['j-bank', 'j-ins'])
    expect(ids({ industry: 'finance.bank' })).toEqual(['j-bank'])
  })
  it('tags match when company has any selected tag', () => {
    expect(ids({ tags: ['FORTUNE_500', 'SOE'] })).toEqual(['j-bank', 'j-ins'])
    expect(ids({ tags: ['MULTINATIONAL'] })).toEqual([])
  })
  it('salary band uses salaryMax', () => {
    expect(ids({ salaryAtLeast: 3000 })).toEqual(['j-bank'])
  })
  it('salary band excludes hidden-salary jobs', () => {
    expect(ids({ salaryAtLeast: 3000 })).not.toContain('j-hosp')
    expect(ids({})).toContain('j-hosp')
  })
  it('near filter drops far jobs', () => {
    expect(ids({ near: { landmarkId: 'klcc', radiusKm: 5 } })).toEqual(['j-bank'])
  })
  it('unknown landmark does not filter anything out', () => {
    expect(ids({ near: { landmarkId: 'nowhere', radiusKm: 5 } })).toHaveLength(3)
  })
  it('parseFilters and toParams round-trip', () => {
    const f: JobFilters = { industry: 'finance', tags: ['FORTUNE_500', 'SOE'], salaryAtLeast: 3000, near: { landmarkId: 'klcc', radiusKm: 5 } }
    expect(parseFilters(new URLSearchParams(toParams(f)))).toEqual(f)
    expect(parseFilters(new URLSearchParams(''))).toEqual({})
  })
})
