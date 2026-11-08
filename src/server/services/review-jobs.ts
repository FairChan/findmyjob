import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { logAudit } from './audit'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { createNotification } from './notifications'
import { sendNotificationEmail } from './notify'
import type { UserCtx } from '../authz'

export const approveJobSchema = z.object({
  jobId: z.string().min(1),
  updatedAt: z.coerce.date(),
})

export type ApproveJobInput = z.infer<typeof approveJobSchema>

export const rejectJobSchema = z.object({
  jobId: z.string().min(1),
  reviewNote: z.string().trim().min(1).max(2000),
  updatedAt: z.coerce.date(),
})

export type RejectJobInput = z.infer<typeof rejectJobSchema>

async function assertAdminUser(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!user || user.role !== 'ADMIN') throw new ForbiddenError()
}

export async function listPendingJobs(ctx: UserCtx) {
  await assertAdminUser(ctx.userId)
  return db.job.findMany({
    where: { status: 'PENDING_REVIEW' },
    include: {
      company: { select: { id: true, legalName: true } },
    },
    orderBy: { updatedAt: 'asc' },
  })
}

export async function getJobForReview(ctx: UserCtx, jobId: string) {
  await assertAdminUser(ctx.userId)
  return db.job.findUnique({
    where: { id: jobId },
    include: {
      company: { select: { id: true, legalName: true } },
    },
  })
}

export async function approveJob(ctx: UserCtx, input: ApproveJobInput): Promise<void> {
  const { userId } = ctx
  await assertAdminUser(userId)

  const jobBase = await db.job.findUnique({
    where: { id: input.jobId },
    select: { id: true },
  })
  if (!jobBase) throw new NotFoundError()

  let companyId!: string
  let createdById!: string

  await db.$transaction(async tx => {
    // Read current state inside transaction to avoid race with concurrent updates
    const job = await tx.job.findUnique({
      where: { id: input.jobId },
      select: { id: true, companyId: true, createdById: true, publishedAt: true, status: true },
    })
    if (!job) throw new NotFoundError()

    companyId = job.companyId
    createdById = job.createdById

    // Status check first so callers get a consistent ValidationError for wrong-status jobs
    if (job.status !== 'PENDING_REVIEW') {
      throw new ValidationError('职位已被修改或已处理，请刷新后再审')
    }

    // Re-check company verification and isActive before approving
    const company = await tx.company.findUnique({
      where: { id: job.companyId },
      select: { verificationStatus: true, isActive: true },
    })
    if (!company || company.verificationStatus !== 'VERIFIED' || !company.isActive) {
      throw new ForbiddenError('Company is not verified or is inactive')
    }

    const result = await tx.job.updateMany({
      where: { id: input.jobId, status: 'PENDING_REVIEW', updatedAt: input.updatedAt },
      data: {
        status: 'PUBLISHED',
        // Preserve original publishedAt if re-approving after edit; otherwise stamp now
        publishedAt: job.publishedAt ?? new Date(),
        reviewNote: null,
      },
    })

    if (result.count !== 1) {
      throw new ValidationError('职位已被修改或已处理，请刷新后再审')
    }

    // Only increment approvedJobCount the first time the job is published
    if (job.publishedAt === null) {
      await tx.company.update({
        where: { id: job.companyId },
        data: { approvedJobCount: { increment: 1 } },
      })
    }

    await createNotification(tx, job.createdById, 'job.approved', {
      jobId: job.id,
    })
  })

  await logAudit({
    actorId: userId,
    action: 'job.review',
    targetType: 'Job',
    targetId: jobBase.id,
    metadata: { decision: 'approved' },
  })

  // Post-commit email to job creator (best-effort)
  const job = await db.job.findUnique({ where: { id: jobBase.id }, select: { title: true } })
  await sendNotificationEmail(createdById, {
    template: 'job-review',
    approved: true,
    jobTitle: job?.title ?? '',
  }).catch(() => {})
}

export async function rejectJob(ctx: UserCtx, input: RejectJobInput): Promise<void> {
  const { userId } = ctx
  await assertAdminUser(userId)

  const jobBase = await db.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, createdById: true },
  })
  if (!jobBase) throw new NotFoundError()

  await db.$transaction(async tx => {
    const result = await tx.job.updateMany({
      where: { id: input.jobId, status: 'PENDING_REVIEW', updatedAt: input.updatedAt },
      data: {
        status: 'REJECTED',
        reviewNote: input.reviewNote,
      },
    })

    if (result.count !== 1) {
      throw new ValidationError('职位已被修改或已处理，请刷新后再审')
    }

    await createNotification(tx, jobBase.createdById, 'job.rejected', {
      jobId: jobBase.id,
      reviewNote: input.reviewNote,
    })
  })

  await logAudit({
    actorId: userId,
    action: 'job.review',
    targetType: 'Job',
    targetId: jobBase.id,
    metadata: { decision: 'rejected', reviewNote: input.reviewNote },
  })

  // Post-commit email to job creator (best-effort)
  const jobForEmail = await db.job.findUnique({ where: { id: jobBase.id }, select: { title: true } })
  await sendNotificationEmail(jobBase.createdById, {
    template: 'job-review',
    approved: false,
    jobTitle: jobForEmail?.title ?? '',
    reviewNote: input.reviewNote,
  }).catch(() => {})
}
