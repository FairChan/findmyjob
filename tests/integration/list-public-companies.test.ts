/**
 * Integration tests for listPublicCompanies (M3-T05 补修).
 */
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { listPublicCompanies } from '@/server/services/company'
import type { CompanyTag } from '@prisma/client'

setupTestDb()

async function makeVerifiedCompany(opts?: {
  tags?: CompanyTag[]
  isActive?: boolean
  verificationStatus?: 'VERIFIED' | 'PENDING' | 'REJECTED' | 'UNSUBMITTED'
}) {
  const { companyId, userId } = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: companyId },
    data: {
      verificationStatus: opts?.verificationStatus ?? 'VERIFIED',
      isActive: opts?.isActive ?? true,
      ...(opts?.tags !== undefined ? { tags: opts.tags } : {}),
    },
  })
  return { companyId, userId }
}

describe('listPublicCompanies', () => {
  it('excludes PENDING companies', async () => {
    const { companyId } = await makeVerifiedCompany({ verificationStatus: 'PENDING' })
    const { items } = await listPublicCompanies({})
    expect(items.map((c) => c.id)).not.toContain(companyId)
  })

  it('excludes REJECTED companies', async () => {
    const { companyId } = await makeVerifiedCompany({ verificationStatus: 'REJECTED' })
    const { items } = await listPublicCompanies({})
    expect(items.map((c) => c.id)).not.toContain(companyId)
  })

  it('excludes UNSUBMITTED companies', async () => {
    const { companyId } = await makeVerifiedCompany({ verificationStatus: 'UNSUBMITTED' })
    const { items } = await listPublicCompanies({})
    expect(items.map((c) => c.id)).not.toContain(companyId)
  })

  it('excludes inactive VERIFIED companies', async () => {
    const { companyId } = await makeVerifiedCompany({ isActive: false })
    const { items } = await listPublicCompanies({})
    expect(items.map((c) => c.id)).not.toContain(companyId)
  })

  it('includes VERIFIED active companies', async () => {
    const { companyId } = await makeVerifiedCompany()
    const { items } = await listPublicCompanies({})
    expect(items.map((c) => c.id)).toContain(companyId)
  })

  it('result items do not contain ssmRegNo', async () => {
    await makeVerifiedCompany()
    const { items } = await listPublicCompanies({})
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(Object.keys(item)).not.toContain('ssmRegNo')
    }
  })

  it('publishedJobCount counts only PUBLISHED non-expired jobs', async () => {
    const { companyId, userId } = await makeVerifiedCompany()
    // future deadline — should count
    await testDb.job.create({
      data: {
        companyId,
        createdById: userId,
        title: 'Active Job',
        type: 'FULL_TIME',
        workMode: 'ONSITE',
        status: 'PUBLISHED',
        description: 'Job description',
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    // past deadline — should NOT count
    await testDb.job.create({
      data: {
        companyId,
        createdById: userId,
        title: 'Expired Job',
        type: 'FULL_TIME',
        workMode: 'ONSITE',
        status: 'PUBLISHED',
        description: 'Job description',
        deadline: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      },
    })
    // draft — should NOT count
    await testDb.job.create({
      data: {
        companyId,
        createdById: userId,
        title: 'Draft Job',
        type: 'FULL_TIME',
        workMode: 'ONSITE',
        status: 'DRAFT',
        description: 'Job description',
      },
    })

    const { items } = await listPublicCompanies({})
    const found = items.find((c) => c.id === companyId)
    expect(found).toBeDefined()
    expect(found!.publishedJobCount).toBe(1)
  })

  it('publishedJobCount counts job with null deadline', async () => {
    const { companyId, userId } = await makeVerifiedCompany()
    await testDb.job.create({
      data: {
        companyId,
        createdById: userId,
        title: 'No Deadline Job',
        type: 'INTERNSHIP',
        workMode: 'ONSITE',
        status: 'PUBLISHED',
        description: 'Job description',
        deadline: null,
      },
    })
    const { items } = await listPublicCompanies({})
    const found = items.find((c) => c.id === companyId)
    expect(found).toBeDefined()
    expect(found!.publishedJobCount).toBeGreaterThanOrEqual(1)
  })

  it('tag filter: only shows companies with that tag', async () => {
    const { companyId: alumniId } = await makeVerifiedCompany({ tags: ['ALUMNI'] })
    const { companyId: soeId } = await makeVerifiedCompany({ tags: ['SOE'] })
    const { companyId: noTagId } = await makeVerifiedCompany({ tags: [] })

    const { items: alumniItems } = await listPublicCompanies({ tag: 'ALUMNI' })
    const ids = alumniItems.map((c) => c.id)
    expect(ids).toContain(alumniId)
    expect(ids).not.toContain(soeId)
    expect(ids).not.toContain(noTagId)
  })

  it('returns nextCursor and items in result', async () => {
    const { items, nextCursor } = await listPublicCompanies({})
    expect(Array.isArray(items)).toBe(true)
    // nextCursor is string or null
    expect(nextCursor === null || typeof nextCursor === 'string').toBe(true)
  })
})
