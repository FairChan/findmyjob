import { vi, describe, it, expect } from 'vitest'
import type { Prisma } from '@prisma/client'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { listCompanyBrowseJobs } from '@/server/services/company-browse'

setupTestDb()

async function company(overrides: Prisma.CompanyUpdateInput = {}) {
  const employer = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: employer.companyId },
    data: { verificationStatus: 'VERIFIED', ...overrides },
  })
  return employer
}

async function job(
  employer: { companyId: string; userId: string },
  overrides: Partial<Prisma.JobUncheckedCreateInput> = {},
) {
  return testDb.job.create({
    data: {
      companyId: employer.companyId,
      createdById: employer.userId,
      title: 'Software engineering internship',
      type: 'INTERNSHIP',
      workMode: 'HYBRID',
      status: 'PUBLISHED',
      description: 'PRIVATE_DESCRIPTION_SENTINEL',
      requirements: 'PRIVATE_REQUIREMENTS_SENTINEL',
      benefits: 'PRIVATE_BENEFITS_SENTINEL',
      reviewNote: 'PRIVATE_REVIEW_SENTINEL',
      ...overrides,
    },
  })
}

describe('listCompanyBrowseJobs', () => {
  it('returns only published, unexpired summaries for the selected eligible company', async () => {
    const selected = await company()
    const other = await company()
    const active = await job(selected, { deadline: new Date(Date.now() + 86_400_000) })
    const openEnded = await job(selected, { deadline: null })
    await job(selected, { status: 'DRAFT' })
    await job(selected, { status: 'CLOSED' })
    await job(selected, { status: 'PENDING_REVIEW' })
    await job(selected, { deadline: new Date(Date.now() - 86_400_000) })
    await job(other)

    const result = await listCompanyBrowseJobs(selected.companyId)
    expect(result.items.map(item => item.id).sort()).toEqual([active.id, openEnded.id].sort())
    expect(result.nextCursor).toBeNull()
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual([
        'acceptsStudentPass', 'city', 'id', 'salaryMax', 'salaryMin',
        'sponsorsWorkPass', 'state', 'title', 'type', 'workMode',
      ].sort())
    }
    expect(JSON.stringify(result)).not.toContain('PRIVATE_')
  })

  it.each([
    { verificationStatus: 'PENDING' as const },
    { verificationStatus: 'REJECTED' as const },
    { verificationStatus: 'UNSUBMITTED' as const },
    { isActive: false },
  ])('does not expose jobs when company eligibility is %j', async (eligibility) => {
    const employer = await company(eligibility)
    await job(employer)
    expect(await listCompanyBrowseJobs(employer.companyId)).toEqual({ items: [], nextCursor: null })
  })

  it('clears hidden salary values before returning the summary', async () => {
    const employer = await company()
    const hidden = await job(employer, { salaryVisible: false, salaryMin: 12345, salaryMax: 23456 })
    const visible = await job(employer, { salaryVisible: true, salaryMin: 1500, salaryMax: 2500 })
    const { items } = await listCompanyBrowseJobs(employer.companyId)
    expect(items.find(item => item.id === hidden.id)).toMatchObject({ salaryMin: null, salaryMax: null })
    expect(items.find(item => item.id === visible.id)).toMatchObject({ salaryMin: 1500, salaryMax: 2500 })
    expect(JSON.stringify(items)).not.toMatch(/12345|23456/)
  })

  it('paginates summaries deterministically without duplicates or foreign-company jobs', async () => {
    const employer = await company()
    const other = await company()
    const expected = []
    for (let index = 0; index < 25; index++) expected.push(await job(employer))
    const foreign = await job(other)
    const first = await listCompanyBrowseJobs(employer.companyId)
    expect(first.items.length).toBeGreaterThan(0)
    expect(first.items.length).toBeLessThan(expected.length)
    expect(first.nextCursor).toBe(first.items.at(-1)?.id)
    const second = await listCompanyBrowseJobs(employer.companyId, first.nextCursor!)
    const ids = [...first.items, ...second.items].map(item => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(expected.map(item => item.id).sort())
    expect(ids).not.toContain(foreign.id)
    expect(second.nextCursor).toBeNull()
    expect((await listCompanyBrowseJobs(employer.companyId, foreign.id)).items).toEqual([])
  })

  it('returns an empty result for a missing company', async () => {
    expect(await listCompanyBrowseJobs('cmissingcompany00000000000')).toEqual({ items: [], nextCursor: null })
  })
})
