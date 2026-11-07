/**
 * Unit tests for job-search service — pure functions + mocked DB.
 * Covers the prototype C2 test cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ----- Hoist mocks before imports -----

const mockQueryRaw = vi.hoisted(() => vi.fn())
const mockSynonymFindMany = vi.hoisted(() => vi.fn())
const mockJobFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/server/db', () => ({
  db: {
    $queryRaw: mockQueryRaw,
    searchSynonymGroup: { findMany: mockSynonymFindMany },
    job: { findMany: mockJobFindMany },
  },
}))

const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

import { expandTerms, escapeIlike, searchJobs, _clearSynonymCache } from '@/server/services/job-search'
import { industryMatches } from '@/server/lib/taxonomy/industries'

// Synonym groups matching the prototype + seed data
const SYNONYM_GROUPS: string[][] = [
  ['财务', '会计', '审计', '出纳', '税务', '金融', 'finance', 'accounting', 'audit'],
  ['管理', '管培生', '管理培训生', 'management', 'mt'],
  ['前端', '前端开发', 'web', 'react', 'vue', 'frontend'],
  ['后端', '后端开发', '服务端', 'java', 'backend'],
  ['数据', '数据分析', '数据科学', 'sql', 'python', 'bi', 'data'],
]

function setupMocks() {
  mockGetSetting.mockImplementation((key: string, def: unknown) => Promise.resolve(
    key === 'search.defaultMode' ? 'RELATED'
    : key === 'search.relatedFallbackBelow' ? 5
    : def
  ))
  mockSynonymFindMany.mockResolvedValue(SYNONYM_GROUPS.map((terms) => ({ terms })))
}

// Helper to build a raw DB row (as returned by $queryRaw)
function makeRow(o: {
  id: string
  title: string
  skills?: string[]
  category?: string | null
  description?: string
  requirements?: string | null
  companyLegal?: string
  industryCode?: string | null
  salaryVisible?: boolean
  salaryMax?: number | null
  publishedAt?: Date
}) {
  return {
    id: o.id,
    title: o.title,
    type: 'INTERNSHIP',
    category: o.category ?? null,
    workMode: 'HYBRID',
    state: null,
    city: null,
    salaryMin: null,
    salaryMax: o.salaryMax ?? null,
    salaryVisible: o.salaryVisible ?? true,
    languages: [],
    skills: o.skills ?? [],
    acceptsStudentPass: false,
    sponsorsWorkPass: false,
    headcount: null,
    deadline: null,
    publishedAt: o.publishedAt ?? new Date('2026-01-01T00:00:00Z'),
    description: o.description ?? '',
    requirements: o.requirements ?? null,
    cId: 'company-1',
    legalName: o.companyLegal ?? 'Acme Corp',
    displayNameZh: null,
    displayNameEn: null,
    industryCode: o.industryCode ?? null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  _clearSynonymCache()
  setupMocks()
})

// ----- expandTerms unit tests -----

describe('expandTerms', () => {
  it('keeps the original term first and lowercases', () => {
    const result = expandTerms('Finance', SYNONYM_GROUPS)
    expect(result[0]).toBe('finance')
    expect(result).toContain('财务')
  })

  it('expands a longer Chinese term that contains a group word', () => {
    expect(expandTerms('财务助理', SYNONYM_GROUPS)).toContain('会计')
  })

  it('does not expand short English words by substring (bim not in any group)', () => {
    expect(expandTerms('bim', SYNONYM_GROUPS)).toEqual(['bim'])
  })

  it('English synonym expands to Chinese synonyms', () => {
    const terms = expandTerms('finance', SYNONYM_GROUPS)
    expect(terms).toContain('财务')
    expect(terms).toContain('会计')
    expect(terms).toContain('金融')
  })

  it('deduplicates output', () => {
    const result = expandTerms('finance', SYNONYM_GROUPS)
    expect(new Set(result).size).toBe(result.length)
  })
})

// ----- escapeIlike unit tests -----

describe('escapeIlike', () => {
  it('escapes percent sign', () => {
    expect(escapeIlike('50%')).toBe('50\\%')
  })

  it('escapes underscore', () => {
    expect(escapeIlike('a_b')).toBe('a\\_b')
  })

  it('escapes backslash', () => {
    expect(escapeIlike('a\\b')).toBe('a\\\\b')
  })

  it('leaves normal Chinese text unchanged', () => {
    expect(escapeIlike('财务助理')).toBe('财务助理')
  })
})

// ----- industryMatches unit tests -----

describe('industryMatches', () => {
  it('parent code matches child (finance.bank matches finance)', () => {
    expect(industryMatches('finance.bank', 'finance')).toBe(true)
  })

  it('parent code matches all children (finance.insurance matches finance)', () => {
    expect(industryMatches('finance.insurance', 'finance')).toBe(true)
  })

  it('child code matches itself exactly', () => {
    expect(industryMatches('finance.bank', 'finance.bank')).toBe(true)
  })

  it('child code does not match sibling parent', () => {
    expect(industryMatches('finance.bank', 'tech')).toBe(false)
  })

  it('null company code returns false', () => {
    expect(industryMatches(null, 'finance')).toBe(false)
  })

  it('code like financeX does not match finance (must have dot separator)', () => {
    expect(industryMatches('financeXYZ', 'finance')).toBe(false)
  })
})

// ----- searchJobs with mocked DB -----

describe('searchJobs', () => {
  it('exact mode: same job ID appears only once (dedup)', async () => {
    const rows = [makeRow({ id: 'a', title: '财务助理' })]
    mockQueryRaw.mockResolvedValue(rows)
    const result = await searchJobs({ q: '财务', mode: 'EXACT', canSeeDescription: false })
    const allIds = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('title match ranks before skills match in exact mode', async () => {
    const rows = [
      makeRow({ id: 'a', title: '财务助理', publishedAt: new Date('2026-01-01') }),
      makeRow({ id: 'c', title: '前端开发', skills: ['财务系统'], publishedAt: new Date('2026-01-02') }),
    ]
    mockQueryRaw.mockResolvedValue(rows)
    const result = await searchJobs({ q: '财务', mode: 'EXACT', canSeeDescription: false })
    // 'a' should be first: title match (score 100) > skills match (score 40)
    expect(result.exact[0].job.id).toBe('a')
  })

  it('related mode adds synonym matches without duplicates', async () => {
    const rows = [
      makeRow({ id: 'a', title: '财务助理' }),
      makeRow({ id: 'b', title: '会计实习生' }),
      makeRow({ id: 'c', title: '前端开发', skills: ['财务系统'] }),
    ]
    mockQueryRaw.mockResolvedValue(rows)
    const result = await searchJobs({ q: '财务', mode: 'RELATED', canSeeDescription: false })
    const allIds = [...result.exact, ...result.related].map((h) => h.job.id)
    // No duplicates
    expect(new Set(allIds).size).toBe(allIds.length)
    // 'b' (会计实习生) matched via synonym, appears in related
    expect(result.related.map((h) => h.job.id)).toContain('b')
  })

  it('English query Finance is case-insensitive and reaches Chinese synonyms', async () => {
    const rows = [
      makeRow({ id: 'a', title: '财务助理' }),
      makeRow({ id: 'b', title: '会计实习生' }),
      makeRow({ id: 'c', title: '前端开发', skills: ['财务系统'] }),
    ]
    mockQueryRaw.mockResolvedValue(rows)
    const result = await searchJobs({ q: 'Finance', mode: 'RELATED', canSeeDescription: false })
    const allIds = [...result.exact, ...result.related].map((h) => h.job.id)
    // All three jobs should be found
    expect(allIds.sort()).toEqual(['a', 'b', 'c'].sort())
  })

  it('exact mode falls back to related when results < relatedFallbackBelow', async () => {
    // With fallbackBelow=5 and only 1 exact hit, related should be shown
    const rows = [
      makeRow({ id: 'a', title: '财务助理' }),  // exact match
      makeRow({ id: 'b', title: '会计实习生' }), // related match (会计 is synonym of 财务)
    ]
    mockQueryRaw.mockResolvedValue(rows)
    const result = await searchJobs({ q: '财务', mode: 'EXACT', canSeeDescription: false })
    // exact.length (1) < fallbackBelow (5), so related should include 'b'
    expect(result.related.map((h) => h.job.id)).toContain('b')
  })

  it('empty query returns all jobs as exact (no related)', async () => {
    const now = new Date()
    mockJobFindMany.mockResolvedValue([
      { id: 'a', title: 'Job A', type: 'INTERNSHIP', category: null, workMode: 'ONSITE', state: null, city: null, salaryMin: null, salaryMax: null, salaryVisible: true, languages: [], skills: [], acceptsStudentPass: false, sponsorsWorkPass: false, headcount: null, deadline: null, publishedAt: now, company: { id: 'c1', legalName: 'Corp', displayNameZh: null, displayNameEn: null } },
      { id: 'b', title: 'Job B', type: 'INTERNSHIP', category: null, workMode: 'ONSITE', state: null, city: null, salaryMin: null, salaryMax: null, salaryVisible: true, languages: [], skills: [], acceptsStudentPass: false, sponsorsWorkPass: false, headcount: null, deadline: null, publishedAt: now, company: { id: 'c1', legalName: 'Corp', displayNameZh: null, displayNameEn: null } },
    ])
    const result = await searchJobs({ q: '  ', mode: 'EXACT' })
    expect(result.exact).toHaveLength(2)
    expect(result.related).toHaveLength(0)
  })

  it('locked jobs are NOT matched by description when canSeeDescription=false', async () => {
    const rows = [
      makeRow({ id: 'x', title: '岗位甲', description: '需要熟悉保密项目' }),
    ]
    mockQueryRaw.mockResolvedValue(rows)
    const result = await searchJobs({ q: '保密', mode: 'EXACT', canSeeDescription: false })
    const allIds = [...result.exact, ...result.related].map((h) => h.job.id)
    // 'x' title '岗位甲' doesn't contain '保密'; description is not searched
    expect(allIds).not.toContain('x')
  })

  it('locked jobs ARE matched by description when canSeeDescription=true', async () => {
    const rows = [
      makeRow({ id: 'x', title: '岗位甲', description: '需要熟悉保密项目' }),
    ]
    mockQueryRaw.mockResolvedValue(rows)
    const result = await searchJobs({ q: '保密', mode: 'EXACT', canSeeDescription: true })
    const allIds = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(allIds).toContain('x')
  })

  it('salary sort: hidden salary jobs ranked last', async () => {
    const rows = [
      makeRow({ id: 'a', title: '高薪职位甲', salaryVisible: true, salaryMax: 10000, publishedAt: new Date('2026-01-01') }),
      makeRow({ id: 'b', title: '高薪职位乙隐藏', salaryVisible: false, salaryMax: 20000, publishedAt: new Date('2026-01-02') }),
      makeRow({ id: 'c', title: '高薪职位丙低', salaryVisible: true, salaryMax: 5000, publishedAt: new Date('2026-01-03') }),
    ]
    mockQueryRaw.mockResolvedValue(rows)
    const result = await searchJobs({
      q: '高薪',
      mode: 'EXACT',
      filters: { sort: 'salary' },
      canSeeDescription: false,
    })
    const all = [...result.exact, ...result.related]
    const ids = all.map((h) => h.job.id)
    // All three rows match '高薪' in title.
    // 'b' has salaryVisible=false → toJobListItem nullifies salaryMax → ranked last by salary sort
    expect(ids).toContain('b')
    expect(ids[ids.length - 1]).toBe('b')
  })

  // ----- Extended filters (M5-T10, prototype C3) -----

  it('C3: empty query with salaryAtLeast passes filter to findMany', async () => {
    mockJobFindMany.mockResolvedValue([])
    await searchJobs({ q: '', filters: { salaryAtLeast: 3000 } })
    const callArgs = mockJobFindMany.mock.calls[0][0]
    expect(callArgs.where).toMatchObject({ salaryVisible: true, salaryMax: { gte: 3000 } })
  })

  it('C3: empty query with industry filter passes company OR condition', async () => {
    mockJobFindMany.mockResolvedValue([])
    await searchJobs({ q: '', filters: { industry: 'finance' } })
    const callArgs = mockJobFindMany.mock.calls[0][0]
    expect(callArgs.where.company).toMatchObject({
      OR: [{ industryCode: 'finance' }, { industryCode: { startsWith: 'finance.' } }],
    })
  })

  it('C3: empty query with tags filter passes company hasSome condition', async () => {
    mockJobFindMany.mockResolvedValue([])
    await searchJobs({ q: '', filters: { tags: ['SOE', 'FORTUNE_500'] } })
    const callArgs = mockJobFindMany.mock.calls[0][0]
    expect(callArgs.where.company).toMatchObject({ tags: { hasSome: ['SOE', 'FORTUNE_500'] } })
  })

  it('C3: empty query with size filter passes company size condition', async () => {
    mockJobFindMany.mockResolvedValue([])
    await searchJobs({ q: '', filters: { size: 'S51_200' } })
    const callArgs = mockJobFindMany.mock.calls[0][0]
    expect(callArgs.where.company).toMatchObject({ size: 'S51_200' })
  })

  it('cursor pagination: second page starts after cursor job', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({ id: `j${i}`, title: `财务职位${i}`, publishedAt: new Date(2026, 0, i + 1) }),
    )
    mockQueryRaw.mockResolvedValue(rows)
    // First page: limit=2
    const page1 = await searchJobs({ q: '财务', mode: 'EXACT', canSeeDescription: false, page: { limit: 2 } })
    expect(page1.exact.length + page1.related.length).toBe(2)
    expect(page1.nextCursor).not.toBeNull()

    // Second page using cursor
    mockQueryRaw.mockResolvedValue(rows)
    const page2 = await searchJobs({
      q: '财务', mode: 'EXACT', canSeeDescription: false,
      page: { cursor: page1.nextCursor!, limit: 2 },
    })
    // No overlap
    const ids1 = [...page1.exact, ...page1.related].map((h) => h.job.id)
    const ids2 = [...page2.exact, ...page2.related].map((h) => h.job.id)
    expect(ids1.some((id) => ids2.includes(id))).toBe(false)
  })
})
