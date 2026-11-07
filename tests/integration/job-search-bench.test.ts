/**
 * Performance benchmark: 10,000 synthetic jobs → common query p95 latencies.
 *
 * Run individually to avoid interfering with the truncate-before-each contract
 * of setupTestDb. Skip in normal CI unless RUN_BENCH=1.
 *
 *   RUN_BENCH=1 pnpm test tests/integration/job-search-bench.test.ts --maxWorkers=1
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))

import { testDb } from '../setup/db'
import { searchJobs, _clearSynonymCache } from '@/server/services/job-search'
import { faker } from '@faker-js/faker'

const RUN_BENCH = process.env.RUN_BENCH === '1'
const BENCH_PREFIX = 'BENCH10K_'
const JOB_COUNT = 10_000
const FINANCE_RATIO = 10 // 1 in 10 jobs have '财务' in title

describe.skipIf(!RUN_BENCH)('searchJobs performance (10k jobs)', { timeout: 600_000 }, () => {
  let seeded = false

  beforeAll(async () => {
    _clearSynonymCache()
    faker.seed(42)

    // Check if bench data already exists from a previous run
    const existing = await testDb.job.count({ where: { title: { startsWith: BENCH_PREFIX } } })
    if (existing >= JOB_COUNT) {
      seeded = true
      return
    }
    if (existing > 0) {
      await testDb.job.deleteMany({ where: { title: { startsWith: BENCH_PREFIX } } })
    }

    const user = await testDb.user.create({
      data: {
        name: 'BenchUser',
        email: `bench-10k@bench.example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const company = await testDb.company.create({
      data: {
        legalName: `BenchCorp10K`,
        verificationStatus: 'VERIFIED',
        isActive: true,
        industryCode: 'tech.software',
      },
    })

    const BATCH = 500
    for (let batch = 0; batch < JOB_COUNT / BATCH; batch++) {
      await testDb.job.createMany({
        data: Array.from({ length: BATCH }, (_, i) => {
          const idx = batch * BATCH + i
          const isFinance = idx % FINANCE_RATIO === 0
          return {
            companyId: company.id,
            createdById: user.id,
            title: isFinance
              ? `${BENCH_PREFIX}财务助理实习 ${idx}`
              : `${BENCH_PREFIX}${faker.person.jobTitle()} ${idx}`,
            type: 'INTERNSHIP',
            workMode: 'HYBRID',
            description: faker.lorem.paragraphs(2),
            skills: Array.from({ length: 3 }, () => faker.hacker.noun()),
            category: faker.person.jobArea(),
            status: 'PUBLISHED',
            publishedAt: faker.date.recent({ days: 90 }),
            salaryMin: faker.number.int({ min: 150_000, max: 300_000 }),
            salaryMax: faker.number.int({ min: 300_000, max: 800_000 }),
            salaryVisible: faker.datatype.boolean(),
          }
        }),
      })
    }
    seeded = true
    console.log(`[BENCH] Seeded ${JOB_COUNT} jobs`)
  })

  afterAll(async () => {
    await testDb.job.deleteMany({ where: { title: { startsWith: BENCH_PREFIX } } })
    await testDb.company.deleteMany({ where: { legalName: 'BenchCorp10K' } })
    await testDb.user.deleteMany({ where: { email: 'bench-10k@bench.example.test' } })
    await testDb.$disconnect()
    console.log('[BENCH] Cleaned up')
  })

  function p95(times: number[]): number {
    const sorted = [...times].sort((a, b) => a - b)
    const idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)
    return sorted[idx]
  }

  it('empty query (relevance): p95 < 500ms', async () => {
    expect(seeded).toBe(true)
    _clearSynonymCache()
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      await searchJobs({ q: '', page: { limit: 20 } })
      times.push(performance.now() - t0)
    }
    const p = p95(times)
    console.log(`[BENCH] empty query p95: ${p.toFixed(1)}ms (20 runs, min=${Math.min(...times).toFixed(1)}ms)`)
    expect(p).toBeLessThan(500)
  })

  it('keyword match (财务 RELATED): p95 < 1000ms', async () => {
    expect(seeded).toBe(true)
    _clearSynonymCache()
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      await searchJobs({ q: '财务', mode: 'RELATED', page: { limit: 20 } })
      times.push(performance.now() - t0)
    }
    const p = p95(times)
    console.log(`[BENCH] keyword 财务 RELATED p95: ${p.toFixed(1)}ms (20 runs)`)
    expect(p).toBeLessThan(1000)
  })

  it('keyword no-match: p95 < 500ms', async () => {
    expect(seeded).toBe(true)
    _clearSynonymCache()
    const sentinel = 'nomatch_xyz_perf_bench'
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      await searchJobs({ q: sentinel, mode: 'EXACT', page: { limit: 20 } })
      times.push(performance.now() - t0)
    }
    const p = p95(times)
    console.log(`[BENCH] keyword no-match p95: ${p.toFixed(1)}ms (20 runs)`)
    expect(p).toBeLessThan(500)
  })

  it('empty query with salary sort: p95 < 1000ms (candidateWindow cap)', async () => {
    expect(seeded).toBe(true)
    _clearSynonymCache()
    const times: number[] = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      await searchJobs({ q: '', filters: { sort: 'salary' }, page: { limit: 20 } })
      times.push(performance.now() - t0)
    }
    const p = p95(times)
    console.log(`[BENCH] empty+salary sort p95: ${p.toFixed(1)}ms (20 runs)`)
    expect(p).toBeLessThan(1000)
  })
})
