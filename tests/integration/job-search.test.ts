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
