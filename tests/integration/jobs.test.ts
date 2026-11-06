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

describe('updateJob — TM-007 sensitive field re-review', () => {
  it('changing title on PUBLISHED job → PENDING_REVIEW', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Original Title',
        type: 'FULL_TIME',
        description: 'Description',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
      },
    })
    const updated = await updateJob(ctx, job.id, {
      ...baseInput,
      title: 'New Title',
      submit: false,
    })
    expect(updated.status).toBe('PENDING_REVIEW')
  })

  it('changing description on PUBLISHED job → PENDING_REVIEW', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Title',
        type: 'INTERNSHIP',
        description: 'Old description',
        status: 'PUBLISHED',
        workMode: 'HYBRID',
      },
    })
    const updated = await updateJob(ctx, job.id, {
      ...baseInput,
      title: 'Title',
      description: 'New description',
      submit: false,
    })
    expect(updated.status).toBe('PENDING_REVIEW')
  })

  it('changing salaryMin on PUBLISHED job → PENDING_REVIEW', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Title',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
        salaryMin: 1000,
      },
    })
    const updated = await updateJob(ctx, job.id, {
      ...baseInput,
      title: 'Title',
      salaryMin: 1500,
      submit: false,
    })
    expect(updated.status).toBe('PENDING_REVIEW')
  })

  it('changing state on PUBLISHED job → PENDING_REVIEW', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Title',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
        state: 'KUL',
      },
    })
    const updated = await updateJob(ctx, job.id, {
      ...baseInput,
      title: 'Title',
      state: 'SGR',
      submit: false,
    })
    expect(updated.status).toBe('PENDING_REVIEW')
  })

  it('non-sensitive field change on PUBLISHED job keeps PUBLISHED status', async () => {
    const ctx = await makeVerifiedCtx()
    const job = await testDb.job.create({
      data: {
        companyId: ctx.companyId,
        createdById: ctx.userId,
        title: 'Title',
        type: 'INTERNSHIP',
        description: 'Description',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
        acceptsStudentPass: false,
      },
    })
    // Only change acceptsStudentPass (non-sensitive); keep all sensitive fields identical
    const updated = await updateJob(ctx, job.id, {
      ...baseInput,
      title: 'Title',
      description: 'Description',
      workMode: 'ONSITE',
      acceptsStudentPass: true,
      submit: false,
    })
    expect(updated.status).toBe('PUBLISHED')
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
