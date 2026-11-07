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
}).refine(
  d => d.salaryMin === undefined || d.salaryMax === undefined || d.salaryMin <= d.salaryMax,
  { message: 'salaryMin must be ≤ salaryMax', path: ['salaryMin'] },
)

export type JobFormInput = z.infer<typeof jobFormSchema>

/** editJobSchema requires updatedAt so the action always enforces version check. */
export const jobEditSchema = jobFormSchema.and(z.object({ updatedAt: z.string().datetime() }))

// Type-exhaustive sensitive-field map. Whitelist = 'skip' (never triggers re-review).
// Everything not 'skip' is 'review' and must be compared. Adding a new field to JobFormInput
// will cause a compile error here until it is explicitly categorised.
const SENSITIVE_FIELD_MAP = {
  title: 'review',
  type: 'review',
  category: 'review',
  description: 'review',
  requirements: 'review',
  benefits: 'review',
  workMode: 'review',
  state: 'review',
  city: 'review',
  salaryMin: 'review',
  salaryMax: 'review',
  salaryVisible: 'review',
  languages: 'review',
  skills: 'review',
  // Whitelist: changing these alone does NOT trigger re-review
  acceptsStudentPass: 'skip',
  sponsorsWorkPass: 'skip',
  headcount: 'skip',
} satisfies Record<keyof Omit<JobFormInput, 'submit' | 'deadline' | 'updatedAt'>, 'review' | 'skip'>

function hasSensitiveChange(
  existing: Job,
  fields: Omit<JobFormInput, 'submit' | 'deadline' | 'updatedAt'>,
): boolean {
  if (SENSITIVE_FIELD_MAP.title === 'review' && fields.title !== existing.title) return true
  if (SENSITIVE_FIELD_MAP.description === 'review' && fields.description !== existing.description) return true
  if (SENSITIVE_FIELD_MAP.requirements === 'review' && (fields.requirements ?? null) !== existing.requirements) return true
  if (SENSITIVE_FIELD_MAP.benefits === 'review' && (fields.benefits ?? null) !== existing.benefits) return true
  if (SENSITIVE_FIELD_MAP.salaryMin === 'review' && (fields.salaryMin ?? null) !== existing.salaryMin) return true
  if (SENSITIVE_FIELD_MAP.salaryMax === 'review' && (fields.salaryMax ?? null) !== existing.salaryMax) return true
  if (SENSITIVE_FIELD_MAP.salaryVisible === 'review' && fields.salaryVisible !== existing.salaryVisible) return true
  if (SENSITIVE_FIELD_MAP.state === 'review' && (fields.state ?? null) !== existing.state) return true
  if (SENSITIVE_FIELD_MAP.city === 'review' && (fields.city ?? null) !== existing.city) return true
  if (SENSITIVE_FIELD_MAP.category === 'review' && (fields.category ?? null) !== existing.category) return true
  if (SENSITIVE_FIELD_MAP.type === 'review' && fields.type !== existing.type) return true
  if (SENSITIVE_FIELD_MAP.workMode === 'review' && fields.workMode !== existing.workMode) return true
  if (SENSITIVE_FIELD_MAP.skills === 'review' && JSON.stringify(fields.skills) !== JSON.stringify(existing.skills)) return true
  if (SENSITIVE_FIELD_MAP.languages === 'review' && JSON.stringify(fields.languages) !== JSON.stringify(existing.languages)) return true
  return false
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

/** Convert an ISO datetime string's date portion to end-of-day Asia/Kuala_Lumpur (UTC+8). */
function toEndOfDayKL(isoDatetime: string): Date {
  const dateStr = isoDatetime.slice(0, 10) // 'YYYY-MM-DD'
  // 23:59:59.999 KL (UTC+8) = 15:59:59.999 UTC
  return new Date(`${dateStr}T15:59:59.999Z`)
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
      deadline: deadline ? toEndOfDayKL(deadline) : null,
    },
  })
}

export async function updateJob(ctx: CompanyCtx, jobId: string, input: JobFormInput) {
  return db.$transaction(async tx => {
    const existing = await tx.job.findFirst({
      where: { id: jobId, companyId: ctx.companyId },
    })
    if (!existing) throw new NotFoundError()

    if (existing.status === 'CLOSED') {
      throw new ValidationError('Cannot edit a closed job')
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
    } else if (existing.status === 'DRAFT' || existing.status === 'PENDING_REVIEW' || existing.status === 'REJECTED') {
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

    let publishedAt: Date | null
    if (newStatus === 'PUBLISHED' && existing.status !== 'PUBLISHED') {
      publishedAt = new Date()
    } else if (newStatus === 'PENDING_REVIEW' && existing.status === 'PUBLISHED') {
      // Going back to review: clear publishedAt so it reflects the eventual re-publish date
      publishedAt = null
    } else {
      publishedAt = existing.publishedAt
    }

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
        deadline: deadline ? toEndOfDayKL(deadline) : null,
        ...(existing.status === 'REJECTED' && newStatus !== 'REJECTED' ? { reviewNote: null } : {}),
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
