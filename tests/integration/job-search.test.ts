/**
 * Integration tests for job-search service using the real test database.
 * Verifies pg_trgm index usage and full search flow.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))

import { setupTestDb, testDb } from '../setup/db'
import { searchJobs, _clearSynonymCache } from '@/server/services/job-search'

setupTestDb()

let companyId: string
let createdById: string

beforeEach(async () => {
  _clearSynonymCache()
  // Create a company + user for test jobs
  const user = await testDb.user.create({
    data: { name: 'Search Test User', email: `search-test-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
  })
  createdById = user.id
  const company = await testDb.company.create({
    data: { legalName: 'SearchTestCorp', verificationStatus: 'VERIFIED', isActive: true },
  })
  companyId = company.id
})

/** Create a company with given attributes and return its id. */
async function createCompany(attrs: { industryCode?: string; tags?: string[]; size?: string }) {
  const c = await testDb.company.create({
    data: {
      legalName: `FilterCorp_${Date.now()}`,
      verificationStatus: 'VERIFIED',
      isActive: true,
      industryCode: attrs.industryCode,
      // Prisma accepts the enum values directly for array fields
      ...(attrs.tags ? { tags: { set: attrs.tags as never } } : {}),
      ...(attrs.size ? { size: attrs.size as never } : {}),
    },
  })
  return c.id
}

/** Create a published job under a specific company. */
async function createJobForCompany(cId: string, overrides: { title: string; salaryMin?: number; salaryMax?: number; salaryVisible?: boolean }) {
  return testDb.job.create({
    data: {
      companyId: cId,
      createdById,
      title: overrides.title,
      type: 'INTERNSHIP',
      workMode: 'HYBRID',
      description: 'filter-test description',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      salaryMin: overrides.salaryMin ?? null,
      salaryMax: overrides.salaryMax ?? null,
      salaryVisible: overrides.salaryVisible ?? true,
    },
  })
}

async function createJob(overrides: {
  title: string
  skills?: string[]
  category?: string
  description?: string
  status?: 'PUBLISHED' | 'DRAFT'
  publishedAt?: Date
}) {
  return testDb.job.create({
    data: {
      companyId,
      createdById,
      title: overrides.title,
      type: 'INTERNSHIP',
      workMode: 'HYBRID',
      description: overrides.description ?? 'default description',
      skills: overrides.skills ?? [],
      category: overrides.category,
      status: overrides.status ?? 'PUBLISHED',
      publishedAt: overrides.publishedAt ?? new Date(),
    },
  })
}

describe('searchJobs integration', () => {
  it('exact mode: finds job by title match', async () => {
    const job = await createJob({ title: '财务助理实习' })
    const result = await searchJobs({ q: '财务', mode: 'EXACT', canSeeDescription: false })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toContain(job.id)
  })

  it('exact mode: does not return jobs without matching title/skills/category', async () => {
    const sentinel = `nomatchtarget${Date.now()}`
    await createJob({ title: '无关职位' })
    const result = await searchJobs({ q: sentinel, mode: 'EXACT', canSeeDescription: false })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    // No results for a unique sentinel that doesn't appear in any job
    expect(ids).toHaveLength(0)
  })

  it('related mode: Finance finds 财务 jobs via synonym group', async () => {
    // Create a synonym group in the DB
    await testDb.searchSynonymGroup.create({
      data: { terms: ['财务', '会计', 'finance', 'accounting', 'audit'], active: true },
    })
    _clearSynonymCache()

    const jobA = await createJob({ title: '财务助理' })
    const jobB = await createJob({ title: '会计实习生' })

    const result = await searchJobs({ q: 'Finance', mode: 'RELATED', canSeeDescription: false })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toContain(jobA.id)
    expect(ids).toContain(jobB.id)
  })

  it('locked jobs are not found by description when canSeeDescription=false', async () => {
    const sentinel = `secretkeyword${Date.now()}`
    const job = await createJob({
      title: '普通职位',
      description: `需要了解${sentinel}相关技术`,
    })
    // Should NOT be found
    const resultLocked = await searchJobs({ q: sentinel, mode: 'EXACT', canSeeDescription: false })
    const lockedIds = [...resultLocked.exact, ...resultLocked.related].map((h) => h.job.id)
    expect(lockedIds).not.toContain(job.id)
  })

  it('locked jobs ARE found by description when canSeeDescription=true', async () => {
    const sentinel = `opensecret${Date.now()}`
    const job = await createJob({
      title: '普通职位二',
      description: `需要了解${sentinel}相关技术`,
    })
    const resultOpen = await searchJobs({ q: sentinel, mode: 'EXACT', canSeeDescription: true })
    const openIds = [...resultOpen.exact, ...resultOpen.related].map((h) => h.job.id)
    expect(openIds).toContain(job.id)
  })

  it('same job appears only once even if it matches multiple terms', async () => {
    const job = await createJob({ title: '财务数据分析师' })
    const result = await searchJobs({ q: '财务 数据', mode: 'RELATED', canSeeDescription: false })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    const occurrences = ids.filter((id) => id === job.id).length
    expect(occurrences).toBeLessThanOrEqual(1)
  })

  it('salary sort: hidden salary jobs ranked last', async () => {
    const sentinel = `salarysort${Date.now()}`
    await createJob({ title: `${sentinel} 高薪可见`, description: sentinel })
    await createJob({ title: `${sentinel} 隐藏薪资` })
    // We need to update salaryVisible — do it after creation
    const hidden = await testDb.job.create({
      data: {
        companyId,
        createdById,
        title: `${sentinel} 隐藏薪资直接`,
        type: 'INTERNSHIP',
        workMode: 'HYBRID',
        description: sentinel,
        salaryMin: 5000,
        salaryMax: 10000,
        salaryVisible: false,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    })
    const visible = await testDb.job.create({
      data: {
        companyId,
        createdById,
        title: `${sentinel} 可见薪资`,
        type: 'INTERNSHIP',
        workMode: 'HYBRID',
        description: sentinel,
        salaryMin: 3000,
        salaryMax: 8000,
        salaryVisible: true,
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - 1000),
      },
    })

    const result = await searchJobs({
      q: sentinel,
      mode: 'EXACT',
      canSeeDescription: true,
      filters: { sort: 'salary' },
    })
    const all = [...result.exact, ...result.related]
    const ids = all.map((h) => h.job.id)
    // Both jobs match the sentinel in description (canSeeDescription=true)
    expect(ids).toContain(hidden.id)
    expect(ids).toContain(visible.id)
    const hiddenIdx = ids.indexOf(hidden.id)
    const visibleIdx = ids.indexOf(visible.id)
    // visible salary job should rank before hidden salary job
    expect(visibleIdx).toBeLessThan(hiddenIdx)
  })

  it('pg_trgm index is used for ILIKE on title (Bitmap Index Scan)', async () => {
    // Force PostgreSQL to use indexes by disabling sequential scans
    await testDb.$executeRaw`SET enable_seqscan = off`
    try {
      const plan = await testDb.$queryRaw<[Record<string, unknown>]>`
        EXPLAIN (FORMAT TEXT)
        SELECT j."id" FROM "Job" j WHERE j."title" ILIKE ${'%财务%'}
      `
      const planText = JSON.stringify(plan)
      // Should use GIN index (Bitmap Index Scan or Index Scan on the trigram index)
      expect(planText).toMatch(/Bitmap Index Scan|Index Scan/i)
    } finally {
      await testDb.$executeRaw`SET enable_seqscan = on`
    }
  })

  it('expired jobs are excluded from results', async () => {
    const sentinel = `expiredjob${Date.now()}`
    await testDb.job.create({
      data: {
        companyId,
        createdById,
        title: sentinel,
        type: 'INTERNSHIP',
        workMode: 'HYBRID',
        description: 'expired',
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - 86400000),
        deadline: new Date(Date.now() - 3600000),
      },
    })
    const result = await searchJobs({ q: sentinel, mode: 'EXACT', canSeeDescription: false })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toHaveLength(0)
  })

  it('draft jobs are excluded from results', async () => {
    const sentinel = `draftjob${Date.now()}`
    await createJob({ title: sentinel, status: 'DRAFT' })
    const result = await searchJobs({ q: sentinel, mode: 'EXACT', canSeeDescription: false })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toHaveLength(0)
  })
})

// ----- Extended filters (prototype C3) -----

describe('searchJobs extended filters (C3)', () => {
  it('C3: industry parent code includes all its children (empty query)', async () => {
    const bankCo = await createCompany({ industryCode: 'finance.bank' })
    const insCo = await createCompany({ industryCode: 'finance.insurance' })
    const techCo = await createCompany({ industryCode: 'tech.software' })
    const jBank = await createJobForCompany(bankCo, { title: `C3bank_${Date.now()}` })
    const jIns = await createJobForCompany(insCo, { title: `C3ins_${Date.now()}` })
    const jTech = await createJobForCompany(techCo, { title: `C3tech_${Date.now()}` })

    const result = await searchJobs({ q: '', filters: { industry: 'finance' } })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toContain(jBank.id)
    expect(ids).toContain(jIns.id)
    expect(ids).not.toContain(jTech.id)
  })

  it('C3: industry child code matches exact child only', async () => {
    const bankCo = await createCompany({ industryCode: 'finance.bank' })
    const insCo = await createCompany({ industryCode: 'finance.insurance' })
    const jBank = await createJobForCompany(bankCo, { title: `C3bankOnly_${Date.now()}` })
    const jIns = await createJobForCompany(insCo, { title: `C3insOnly_${Date.now()}` })

    const result = await searchJobs({ q: '', filters: { industry: 'finance.bank' } })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toContain(jBank.id)
    expect(ids).not.toContain(jIns.id)
  })

  it('C3: tags match when company has any selected tag', async () => {
    const soeCo = await createCompany({ tags: ['SOE'] })
    const f500Co = await createCompany({ tags: ['FORTUNE_500'] })
    const noCo = await createCompany({ tags: [] })
    const jSoe = await createJobForCompany(soeCo, { title: `C3soe_${Date.now()}` })
    const jF500 = await createJobForCompany(f500Co, { title: `C3f500_${Date.now()}` })
    const jNone = await createJobForCompany(noCo, { title: `C3notag_${Date.now()}` })

    const result = await searchJobs({ q: '', filters: { tags: ['FORTUNE_500', 'SOE'] } })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toContain(jSoe.id)
    expect(ids).toContain(jF500.id)
    expect(ids).not.toContain(jNone.id)
  })

  it('C3: tags filter with no matching tag returns no results', async () => {
    const soeCo = await createCompany({ tags: ['SOE'] })
    const jSoe = await createJobForCompany(soeCo, { title: `C3noMatchTag_${Date.now()}` })

    const result = await searchJobs({ q: '', filters: { tags: ['MULTINATIONAL'] } })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).not.toContain(jSoe.id)
  })

  it('C3: size filter matches exact company size', async () => {
    const bigCo = await createCompany({ size: 'S1000_PLUS' })
    const smallCo = await createCompany({ size: 'S1_10' })
    const jBig = await createJobForCompany(bigCo, { title: `C3big_${Date.now()}` })
    const jSmall = await createJobForCompany(smallCo, { title: `C3small_${Date.now()}` })

    const result = await searchJobs({ q: '', filters: { size: 'S1000_PLUS' } })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toContain(jBig.id)
    expect(ids).not.toContain(jSmall.id)
  })

  it('C3: salary band uses salaryMax (job with salaryMax >= band is included)', async () => {
    const co = await createCompany({})
    const jHigh = await createJobForCompany(co, { title: `C3salHigh_${Date.now()}`, salaryMax: 3500 })
    const jLow = await createJobForCompany(co, { title: `C3salLow_${Date.now()}`, salaryMax: 2000 })

    const result = await searchJobs({ q: '', filters: { salaryAtLeast: 3000 } })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toContain(jHigh.id)
    expect(ids).not.toContain(jLow.id)
  })

  it('C3: salary band excludes hidden-salary jobs', async () => {
    const co = await createCompany({})
    const jHidden = await createJobForCompany(co, {
      title: `C3salHidden_${Date.now()}`,
      salaryMax: 9000,
      salaryVisible: false,
    })
    const jVisible = await createJobForCompany(co, {
      title: `C3salVisible_${Date.now()}`,
      salaryMax: 4000,
    })

    const resultWithFilter = await searchJobs({ q: '', filters: { salaryAtLeast: 3000 } })
    const idsFiltered = [...resultWithFilter.exact, ...resultWithFilter.related].map((h) => h.job.id)
    // Hidden salary job must NOT appear in salary-filtered results
    expect(idsFiltered).not.toContain(jHidden.id)
    // Visible job with salaryMax >= 3000 must appear
    expect(idsFiltered).toContain(jVisible.id)

    // Without the salary filter, hidden salary job IS accessible
    const resultAll = await searchJobs({ q: '' })
    const idsAll = [...resultAll.exact, ...resultAll.related].map((h) => h.job.id)
    expect(idsAll).toContain(jHidden.id)
  })

  it('C3: keyword search with industry filter (non-empty query)', async () => {
    const sentinel = `C3keyInd_${Date.now()}`
    const bankCo = await createCompany({ industryCode: 'finance.bank' })
    const techCo = await createCompany({ industryCode: 'tech.software' })
    const jBank = await createJobForCompany(bankCo, { title: `${sentinel} banking role` })
    const jTech = await createJobForCompany(techCo, { title: `${sentinel} tech role` })

    const result = await searchJobs({ q: sentinel, mode: 'EXACT', filters: { industry: 'finance' } })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toContain(jBank.id)
    expect(ids).not.toContain(jTech.id)
  })

  it('C3: keyword search with salary band excludes hidden salary (non-empty query)', async () => {
    const sentinel = `C3keySal_${Date.now()}`
    const co = await createCompany({})
    const jHidden = await createJobForCompany(co, {
      title: `${sentinel} hidden-sal`,
      salaryMax: 10000,
      salaryVisible: false,
    })
    const jVisible = await createJobForCompany(co, {
      title: `${sentinel} visible-sal`,
      salaryMax: 5000,
    })

    const result = await searchJobs({
      q: sentinel,
      mode: 'EXACT',
      filters: { salaryAtLeast: 3000 },
      canSeeDescription: false,
    })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).not.toContain(jHidden.id)
    expect(ids).toContain(jVisible.id)
  })
})

// ----- industry ILIKE escaping (red line: 用户输入放进 LIKE 之前先转义) -----

describe('searchJobs industry filter ILIKE escaping', () => {
  it('underscore in industry code is treated as literal, not wildcard', async () => {
    // a_b.x: exact match; axb.y: must NOT appear (without escaping, _ is a wildcard so axb matches a_b)
    const co1 = await createCompany({ industryCode: 'a_b.x' })
    const co2 = await createCompany({ industryCode: 'axb.y' })
    const j1 = await createJobForCompany(co1, { title: `ilike_underscore_${Date.now()}_abx` })
    const j2 = await createJobForCompany(co2, { title: `ilike_underscore_${Date.now()}_axby` })

    const result = await searchJobs({ q: '', filters: { industry: 'a_b' } })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    expect(ids).toContain(j1.id)
    expect(ids).not.toContain(j2.id)
  })

  it('percent in industry code is treated as literal, not wildcard', async () => {
    // industry='%': without escaping, LIKE '%.%' matches everything with a dot; with fix, matches nothing
    const co = await createCompany({ industryCode: 'finance.bank' })
    const j = await createJobForCompany(co, { title: `ilike_pct_${Date.now()}` })

    const result = await searchJobs({ q: '', filters: { industry: '%' } })
    const ids = [...result.exact, ...result.related].map((h) => h.job.id)
    // No company has industryCode='%' or '%.<anything>' literally
    expect(ids).not.toContain(j.id)
  })
})
