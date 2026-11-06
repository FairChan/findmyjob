import 'server-only'
import { z } from 'zod'
import type { Job, JobStatus } from '@prisma/client'
import { db } from '../db'
import { getSetting } from './settings'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import type { CompanyCtx } from '../authz'

export const jobFormSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(['INTERNSHIP', 'FULL_TIME', 'PART_TIME']),
  category: z.string().max(100).optional(),
  description: z.string().min(1).max(10000),
  requirements: z.string().max(5000).optional(),
  benefits: z.string().max(5000).optional(),
  workMode: z.enum(['ONSITE', 'HYBRID', 'REMOTE']).default('ONSITE'),
  state: z.string().max(10).optional(),
  city: z.string().max(100).optional(),
  salaryMin: z.number().int().min(0).optional(),
  salaryMax: z.number().int().min(0).optional(),
  salaryVisible: z.boolean().default(true),
  languages: z.array(z.string().max(50)).max(10).default([]),
  skills: z.array(z.string().max(100)).max(30).default([]),
  acceptsStudentPass: z.boolean().default(false),
  sponsorsWorkPass: z.boolean().default(false),
  headcount: z.number().int().min(1).max(9999).optional(),
  deadline: z.string().datetime().optional(),
  submit: z.boolean().default(false),
  updatedAt: z.string().datetime().optional(),
})

export type JobFormInput = z.infer<typeof jobFormSchema>

// Whitelist: headcount, deadline, acceptsStudentPass, sponsorsWorkPass never trigger re-review.
// Everything else is sensitive and requires re-review when changed on a PUBLISHED job.
function hasSensitiveChange(
  existing: Job,
  fields: Omit<JobFormInput, 'submit' | 'deadline' | 'updatedAt'>,
): boolean {
  return (
    fields.title !== existing.title ||
    fields.description !== existing.description ||
    (fields.requirements ?? null) !== existing.requirements ||
    (fields.benefits ?? null) !== existing.benefits ||
    (fields.salaryMin ?? null) !== existing.salaryMin ||
    (fields.salaryMax ?? null) !== existing.salaryMax ||
    fields.salaryVisible !== existing.salaryVisible ||
    (fields.state ?? null) !== existing.state ||
    (fields.city ?? null) !== existing.city ||
    (fields.category ?? null) !== existing.category ||
    fields.type !== existing.type ||
    fields.workMode !== existing.workMode ||
    JSON.stringify(fields.skills) !== JSON.stringify(existing.skills) ||
    JSON.stringify(fields.languages) !== JSON.stringify(existing.languages)
  )
}

async function resolveSubmitStatus(companyId: string): Promise<JobStatus> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { verificationStatus: true, approvedJobCount: true },
  })
  if (!company) throw new NotFoundError()
  if (company.verificationStatus !== 'VERIFIED') {
    throw new ForbiddenError('Company must be verified to submit jobs for review')
  }
  const autoPublishAfter = await getSetting<number>('jobs.autoPublishAfter', 1000)
  return company.approvedJobCount >= autoPublishAfter ? 'PUBLISHED' : 'PENDING_REVIEW'
}

export async function listCompanyJobs(ctx: CompanyCtx) {
  return db.job.findMany({
    where: { companyId: ctx.companyId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      type: true,
      category: true,
      status: true,
      state: true,
      city: true,
      workMode: true,
      salaryMin: true,
      salaryMax: true,
      salaryVisible: true,
      publishedAt: true,
      closedAt: true,
      deadline: true,
      createdAt: true,
      _count: { select: { applications: true } },
    },
  })
}

export async function getCompanyJob(ctx: CompanyCtx, jobId: string) {
  const job = await db.job.findFirst({
    where: { id: jobId, companyId: ctx.companyId },
  })
  if (!job) throw new NotFoundError()
  return job
}

export async function createJob(ctx: CompanyCtx, input: JobFormInput) {
  const { submit, deadline, ...fields } = input
  const status: JobStatus = submit ? await resolveSubmitStatus(ctx.companyId) : 'DRAFT'

  return db.job.create({
    data: {
      ...fields,
      companyId: ctx.companyId,
      createdById: ctx.userId,
      status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
      deadline: deadline ? new Date(deadline) : null,
    },
  })
}

export async function updateJob(ctx: CompanyCtx, jobId: string, input: JobFormInput) {
  return db.$transaction(async tx => {
    const existing = await tx.job.findFirst({
      where: { id: jobId, companyId: ctx.companyId },
    })
    if (!existing) throw new NotFoundError()

    if (existing.status === 'CLOSED' || existing.status === 'REJECTED') {
      throw new ValidationError('Cannot edit a closed or rejected job')
    }

    const { submit, deadline, updatedAt: clientUpdatedAt, ...rawFields } = input

    // Explicitly null out cleared optional fields so clearing a value is saved.
    const fields = {
      ...rawFields,
      requirements: rawFields.requirements ?? null,
      benefits: rawFields.benefits ?? null,
      state: rawFields.state ?? null,
      city: rawFields.city ?? null,
      salaryMin: rawFields.salaryMin ?? null,
      salaryMax: rawFields.salaryMax ?? null,
      category: rawFields.category ?? null,
      headcount: rawFields.headcount ?? null,
    }

    let newStatus = existing.status as JobStatus

    if (existing.status === 'PUBLISHED') {
      if (hasSensitiveChange(existing, rawFields)) {
        const autoPublishAfter = await getSetting<number>('jobs.autoPublishAfter', 1000)
        const company = await tx.company.findUnique({
          where: { id: ctx.companyId },
          select: { approvedJobCount: true },
        })
        if (!company || company.approvedJobCount < autoPublishAfter) {
          newStatus = 'PENDING_REVIEW'
        }
      }
    } else if (existing.status === 'DRAFT' || existing.status === 'PENDING_REVIEW') {
      if (submit) {
        const company = await tx.company.findUnique({
          where: { id: ctx.companyId },
          select: { verificationStatus: true, approvedJobCount: true },
        })
        if (!company) throw new NotFoundError()
        if (company.verificationStatus !== 'VERIFIED') {
          throw new ForbiddenError('Company must be verified to submit jobs for review')
        }
        const autoPublishAfter = await getSetting<number>('jobs.autoPublishAfter', 1000)
        newStatus = company.approvedJobCount >= autoPublishAfter ? 'PUBLISHED' : 'PENDING_REVIEW'
      }
    }

    const publishedAt =
      newStatus === 'PUBLISHED' && existing.status !== 'PUBLISHED'
        ? new Date()
        : existing.publishedAt

    const updateResult = await tx.job.updateMany({
      where: {
        id: jobId,
        companyId: ctx.companyId,
        ...(clientUpdatedAt ? { updatedAt: new Date(clientUpdatedAt) } : {}),
      },
      data: {
        ...fields,
        status: newStatus,
        publishedAt,
        deadline: deadline ? new Date(deadline) : null,
      },
    })

    if (updateResult.count !== 1) {
      throw new ValidationError('职位已被修改，请刷新后再改')
    }

    return tx.job.findUniqueOrThrow({ where: { id: jobId } })
  })
}

export async function copyJob(ctx: CompanyCtx, jobId: string, copySuffix = ' (复制)') {
  const existing = await db.job.findFirst({
    where: { id: jobId, companyId: ctx.companyId },
  })
  if (!existing) throw new NotFoundError()

  const {
    id: _id,
    status: _status,
    publishedAt: _publishedAt,
    closedAt: _closedAt,
    reviewNote: _reviewNote,
    viewCount: _viewCount,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = existing

  const maxLen = 200
  const truncatedBase = existing.title.slice(0, maxLen - copySuffix.length)

  return db.job.create({
    data: {
      ...rest,
      title: `${truncatedBase}${copySuffix}`,
      status: 'DRAFT',
      publishedAt: null,
      closedAt: null,
      reviewNote: null,
      viewCount: 0,
      createdById: ctx.userId,
    },
  })
}

export async function closeJob(ctx: CompanyCtx, jobId: string) {
  const existing = await db.job.findFirst({
    where: { id: jobId, companyId: ctx.companyId },
  })
  if (!existing) throw new NotFoundError()

  if (existing.status === 'CLOSED') return existing
  if (existing.status === 'DRAFT' || existing.status === 'REJECTED') {
    throw new ValidationError('Cannot close a draft or rejected job')
  }

  return db.job.update({
    where: { id: jobId },
    data: { status: 'CLOSED', closedAt: new Date() },
  })
}
