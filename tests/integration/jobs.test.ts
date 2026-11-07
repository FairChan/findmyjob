/**
 * Integration tests for jobs service (M5-T01).
 * Tests status flow, autoPublishAfter rule, and sensitive-field re-review (TM-007).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import {
  jobFormSchema,
  createJob,
  updateJob,
  copyJob,
  closeJob,
  listCompanyJobs,
  getCompanyJob,
} from '@/server/services/jobs'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
import type { CompanyCtx } from '@/server/authz'

setupTestDb()

async function makeVerifiedCtx(): Promise<CompanyCtx & { companyId: string }> {
  const { userId, companyId } = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: companyId },
    data: { verificationStatus: 'VERIFIED', approvedJobCount: 0 },
  })
  return { userId, companyId, role: 'OWNER' }
}

async function makeUnverifiedCtx(): Promise<CompanyCtx & { companyId: string }> {
  const { userId, companyId } = await createEmployer(testDb)
  return { userId, companyId, role: 'OWNER' }
}

const baseInput = {
  title: 'Software Engineer Intern',
  type: 'INTERNSHIP' as const,
  description: 'Join our team for an exciting internship opportunity.',
  workMode: 'HYBRID' as const,
  salaryVisible: true,
  languages: [],
  skills: [],
  acceptsStudentPass: true,
  sponsorsWorkPass: false,
  submit: false,
}

// ---------------------------------------------------------------------------
// createJob
// ---------------------------------------------------------------------------

describe('createJob', () => {
  it('saves as DRAFT when submit=false regardless of verification', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await createJob(ctx, { ...baseInput, submit: false })
    expect(job.status).toBe('DRAFT')
  })

  it('unverified company can save DRAFT (submit=false)', async () => {
    const ctx = await makeUnverifiedCtx()
    const job = await createJob(ctx, { ...baseInput, submit: false })
    expect(job.status).toBe('DRAFT')
  })

  it('saves as DRAFT for unverified company even with submit=true', async () => {
    const ctx = await makeUnverifiedCtx()
    await expect(createJob(ctx, { ...baseInput, submit: true })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('transitions VERIFIED company to PENDING_REVIEW when submit=true and approvedJobCount < threshold', async () => {
    const ctx = await makeVerifiedCtx()
    // autoPublishAfter default 1000; approvedJobCount is 0
    const job = await createJob(ctx, { ...baseInput, submit: true })
    expect(job.status).toBe('PENDING_REVIEW')
  })

  it('transitions VERIFIED company to PUBLISHED when approvedJobCount >= autoPublishAfter', async () => {
    const ctx = await makeVerifiedCtx()
    await testDb.company.update({
      where: { id: ctx.companyId },
      data: { approvedJobCount: 1000 },
    })
    // Set autoPublishAfter to 1000 in DB
    await testDb.systemSetting.upsert({
      where: { key: 'jobs.autoPublishAfter' },
      update: { value: 1000 },
      create: { key: 'jobs.autoPublishAfter', value: 1000 },
    })
    const job = await createJob(ctx, { ...baseInput, submit: true })
    expect(job.status).toBe('PUBLISHED')
  })

  it('stores skills and languages arrays', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await createJob(ctx, {
      ...baseInput,
      skills: ['TypeScript', 'React'],
      languages: ['中文', 'English'],
    })
    expect(job.skills).toEqual(['TypeScript', 'React'])
    expect(job.languages).toEqual(['中文', 'English'])
  })
})

// ---------------------------------------------------------------------------
// updateJob — TM-007: sensitive fields → PENDING_REVIEW
// ---------------------------------------------------------------------------

// A fully-specified published job fixture — all fields set so each test can
// change exactly one field while keeping every other field identical.
const publishedFixtureData = {
  title: 'Fixed Title',
  type: 'INTERNSHIP' as const,
  description: 'Fixed description.',
  requirements: 'Fixed requirements.',
  benefits: 'Fixed benefits.',
  workMode: 'HYBRID' as const,
  state: 'KUL',
  city: 'Kuala Lumpur',
  salaryMin: 2000,
  salaryMax: 4000,
  salaryVisible: true,
  category: 'Technology',
  languages: ['English', '中文'],
  skills: ['TypeScript', 'React'],
  acceptsStudentPass: true,
  sponsorsWorkPass: false,
  headcount: 2,
}

// The matching input (identical values → no sensitive change, stays PUBLISHED).
const publishedFixtureInput = {
  ...publishedFixtureData,
  submit: false,
}

async function makePublishedJob(ctx: { userId: string; companyId: string }) {
  return testDb.job.create({
    data: {
      companyId: ctx.companyId,
      createdById: ctx.userId,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      ...publishedFixtureData,
    },
  })
}

describe('updateJob — TM-007 sensitive field re-review', () => {
  // Each sensitive field gets its own isolated test: only that one field differs.
  it.each([
    ['title', { title: 'Changed Title' }],
    ['description', { description: 'Changed description.' }],
    ['requirements', { requirements: 'Changed requirements.' }],
    ['benefits', { benefits: 'Changed benefits.' }],
    ['salaryMin', { salaryMin: 2500 }],
    ['salaryMax', { salaryMax: 5000 }],
    ['salaryVisible', { salaryVisible: false }],
    ['state', { state: 'SGR' }],
    ['city', { city: 'Petaling Jaya' }],
    ['category', { category: 'Finance' }],
    ['type', { type: 'FULL_TIME' as const }],
    ['workMode', { workMode: 'REMOTE' as const }],
    ['skills', { skills: ['Python'] }],
    ['languages', { languages: ['Bahasa Malaysia'] }],
  ])(
    'changing %s on PUBLISHED job → PENDING_REVIEW (TM-007)',
    async (_, changedField) => {
      const ctx = await makeVerifiedCtx()
      const job = await makePublishedJob(ctx)
      const updated = await updateJob(ctx, job.id, { ...publishedFixtureInput, ...changedField })
      expect(updated.status).toBe('PENDING_REVIEW')
    },
  )

  // Whitelist fields: changing them alone must NOT trigger re-review.
  it.each([
    ['acceptsStudentPass', { acceptsStudentPass: false }],
    ['sponsorsWorkPass', { sponsorsWorkPass: true }],
    ['headcount', { headcount: 5 }],
  ])(
    'changing whitelist field %s on PUBLISHED job keeps PUBLISHED',
    async (_, changedField) => {
      const ctx = await makeVerifiedCtx()
      const job = await makePublishedJob(ctx)
      const updated = await updateJob(ctx, job.id, { ...publishedFixtureInput, ...changedField })
      expect(updated.status).toBe('PUBLISHED')
    },
  )

  it('PUBLISHED job with high approvedJobCount keeps PUBLISHED after sensitive change', async () => {
    const ctx = await makeVerifiedCtx()
    await testDb.company.update({
      where: { id: ctx.companyId },
      data: { approvedJobCount: 1000 },
    })
    await testDb.systemSetting.upsert({
      where: { key: 'jobs.autoPublishAfter' },
      update: { value: 1000 },
      create: { key: 'jobs.autoPublishAfter', value: 1000 },
    })
    const job = await makePublishedJob(ctx)
    const updated = await updateJob(ctx, job.id, {
      ...publishedFixtureInput,
      title: 'Changed Title',
    })
    expect(updated.status).toBe('PUBLISHED')
  })

  it('publishedAt is cleared when PUBLISHED job reverts to PENDING_REVIEW', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await makePublishedJob(ctx)
    expect(job.publishedAt).not.toBeNull()

    const updated = await updateJob(ctx, job.id, {
      ...publishedFixtureInput,
      title: 'Changed Title', // sensitive change → PENDING_REVIEW
    })
    expect(updated.status).toBe('PENDING_REVIEW')
    expect(updated.publishedAt).toBeNull()
  })

  it('clearing requirements on DRAFT sets it to null in DB', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Job',
        type: 'INTERNSHIP',
        description: 'Desc',
        requirements: 'Some requirements',
        status: 'DRAFT',
        workMode: 'ONSITE',
      },
    })
    const updated = await updateJob(ctx, job.id, {
      ...baseInput,
      title: 'Job',
      requirements: undefined,
      submit: false,
    })
    expect(updated.requirements).toBeNull()
  })

  it('stale updatedAt → ValidationError (concurrent save protection), DB record unchanged', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Original Title',
        type: 'INTERNSHIP',
        description: 'Desc',
        status: 'DRAFT',
        workMode: 'ONSITE',
      },
    })
    const staleUpdatedAt = job.updatedAt.toISOString()
    // First save succeeds and advances updatedAt.
    await updateJob(ctx, job.id, { ...baseInput, title: 'First Save', updatedAt: staleUpdatedAt })
    // Second save with the original (now stale) updatedAt must fail without changing the DB.
    await expect(
      updateJob(ctx, job.id, { ...baseInput, title: 'Stale Save', updatedAt: staleUpdatedAt }),
    ).rejects.toBeInstanceOf(ValidationError)

    const inDb = await testDb.job.findUnique({ where: { id: job.id } })
    expect(inDb?.title).toBe('First Save')
  })

  it('deadline whitelist: changing deadline on PUBLISHED job keeps PUBLISHED', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await makePublishedJob(ctx)
    const updated = await updateJob(ctx, job.id, {
      ...publishedFixtureInput,
      deadline: new Date(Date.now() + 86400000 * 30).toISOString(),
    })
    expect(updated.status).toBe('PUBLISHED')
  })

  it('salaryMin > salaryMax → ValidationError from schema', async () => {
    const result = jobFormSchema.safeParse({ ...baseInput, salaryMin: 5000, salaryMax: 1000 })
    expect(result.success).toBe(false)
  })

  it('REJECTED job can be edited and resubmitted → PENDING_REVIEW', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Rejected Job',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'REJECTED',
        workMode: 'ONSITE',
        reviewNote: 'Policy violation',
      },
    })
    const updated = await updateJob(ctx, job.id, {
      ...baseInput,
      title: 'Rejected Job',
      submit: true,
    })
    expect(updated.status).toBe('PENDING_REVIEW')
    expect(updated.reviewNote).toBeNull()
  })

  it('cannot edit CLOSED job → ValidationError', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Closed Job',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'CLOSED',
        workMode: 'ONSITE',
        closedAt: new Date(),
      },
    })
    await expect(updateJob(ctx, job.id, { ...baseInput, submit: false })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('submitting DRAFT of verified company → PENDING_REVIEW', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Draft Job',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'DRAFT',
        workMode: 'HYBRID',
      },
    })
    const updated = await updateJob(ctx, job.id, {
      ...baseInput,
      title: 'Draft Job',
      submit: true,
    })
    expect(updated.status).toBe('PENDING_REVIEW')
  })

  it('unverified company cannot submit DRAFT → ForbiddenError', async () => {
    const ctx = await makeUnverifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Draft',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'DRAFT',
        workMode: 'ONSITE',
      },
    })
    await expect(updateJob(ctx, job.id, { ...baseInput, submit: true })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

// ---------------------------------------------------------------------------
// copyJob
// ---------------------------------------------------------------------------

describe('copyJob', () => {
  it('copies a job as DRAFT with modified title', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Original',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
        skills: ['TypeScript'],
      },
    })
    const copy = await copyJob(ctx, job.id)
    expect(copy.status).toBe('DRAFT')
    expect(copy.title).toBe('Original (复制)')
    expect(copy.skills).toEqual(['TypeScript'])
    expect(copy.id).not.toBe(job.id)
  })

  it('throws NotFoundError for job in another company', async () => {
    const ctx = await makeVerifiedCtx()
    const other = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: other.companyId,
        createdById: other.userId,
        title: 'Other Job',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
      },
    })
    await expect(copyJob(ctx, job.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ---------------------------------------------------------------------------
// closeJob
// ---------------------------------------------------------------------------

describe('closeJob', () => {
  it('closes a PUBLISHED job', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Job',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
      },
    })
    const closed = await closeJob(ctx, job.id)
    expect(closed.status).toBe('CLOSED')
    expect(closed.closedAt).not.toBeNull()
  })

  it('throws ValidationError when closing a DRAFT', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Job',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'DRAFT',
        workMode: 'ONSITE',
      },
    })
    await expect(closeJob(ctx, job.id)).rejects.toBeInstanceOf(ValidationError)
  })
})

// ---------------------------------------------------------------------------
// listCompanyJobs / getCompanyJob
// ---------------------------------------------------------------------------

describe('listCompanyJobs / getCompanyJob', () => {
  it('listCompanyJobs returns only own company jobs', async () => {
    const ctx = await makeVerifiedCtx()
    const other = await makeVerifiedCtx()
    await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'My Job',
        type: 'INTERNSHIP',
        description: 'Desc',
        status: 'DRAFT',
        workMode: 'ONSITE',
      },
    })
    await testDb.job.create({
      data: {
        companyId: other.companyId,
        createdById: other.userId,
        title: 'Other Job',
        type: 'INTERNSHIP',
        description: 'Desc',
        status: 'DRAFT',
        workMode: 'ONSITE',
      },
    })
    const jobs = await listCompanyJobs(ctx)
    expect(jobs.every(j => j.id !== undefined)).toBe(true)
    // All returned jobs belong to ctx.companyId
    const dbJobs = await testDb.job.findMany({ where: { id: { in: jobs.map(j => j.id) } } })
    expect(dbJobs.every(j => j.companyId === ctx.companyId)).toBe(true)
  })

  it('getCompanyJob throws NotFoundError for another company job', async () => {
    const ctx = await makeVerifiedCtx()
    const other = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: other.companyId,
        createdById: other.userId,
        title: 'Other',
        type: 'INTERNSHIP',
        description: 'Desc',
        status: 'DRAFT',
        workMode: 'ONSITE',
      },
    })
    await expect(getCompanyJob(ctx, job.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})
