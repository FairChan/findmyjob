import { describe, it, expect } from 'vitest'
import { expandTerms, searchJobs, type SearchMode } from './search'
import { fixtureCompany, fixtureJob } from '../test/fixtures'

const jobs = [
  fixtureJob({ id: 'a', title: '财务助理' }),
  fixtureJob({ id: 'b', title: '会计实习生' }),
  fixtureJob({ id: 'c', title: '前端开发', skills: ['财务系统'] }),
  fixtureJob({ id: 'd', title: '土木工程师' }),
]
const run = (q: string, mode: SearchMode, o: { fallbackBelow?: number } = {}) =>
  searchJobs(jobs, q, mode, { companyById: () => fixtureCompany(), ...o })

describe('searchJobs', () => {
  it('exact mode only matches literal tokens', () => {
    const r = run('财务', 'EXACT', { fallbackBelow: 0 })
    expect(r.exact.map((h) => h.job.id)).toEqual(['a', 'c'])
    expect(r.related).toEqual([])
  })
  it('title match ranks before skills match', () => {
    expect(run('财务', 'EXACT').exact[0].job.id).toBe('a')
  })
  it('related mode adds synonym matches without duplicates', () => {
    const r = run('财务', 'RELATED')
    expect(r.related.map((h) => h.job.id)).toEqual(['b'])
    const ids = [...r.exact, ...r.related].map((h) => h.job.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('english query is case-insensitive and reaches chinese synonyms', () => {
    expect(run('Finance', 'RELATED').related.map((h) => h.job.id).sort()).toEqual(['a', 'b', 'c'])
  })
  it('exact mode falls back to related when results are few', () => {
    expect(run('财务', 'EXACT', { fallbackBelow: 5 }).related.map((h) => h.job.id)).toEqual(['b'])
  })
  it('empty query returns all jobs as exact', () => {
    expect(run('  ', 'EXACT').exact).toHaveLength(4)
  })
  it('locked jobs are not matched by their description', () => {
    const locked = [fixtureJob({ id: 'x', title: '岗位甲', description: ['需要熟悉保密项目'] })]
    const opts = { companyById: () => fixtureCompany() }
    expect(searchJobs(locked, '保密', 'EXACT', opts).exact).toHaveLength(1)
    expect(searchJobs(locked, '保密', 'EXACT', { ...opts, canSeeBody: () => false }).exact).toHaveLength(0)
  })
})

describe('expandTerms', () => {
  it('keeps the original term first and lowercases', () => {
    expect(expandTerms('Finance')[0]).toBe('finance')
    expect(expandTerms('Finance')).toContain('财务')
  })
  it('expands a longer chinese term that contains a group word', () => {
    expect(expandTerms('财务助理')).toContain('会计')
  })
  it('does not expand short english words by substring', () => {
    expect(expandTerms('bim')).toEqual(['bim'])
  })
})
