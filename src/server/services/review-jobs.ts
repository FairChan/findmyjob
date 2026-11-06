import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { logAudit } from './audit'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { createNotification } from './notifications'
import type { UserCtx } from '../authz'

export const approveJobSchema = z.object({
  jobId: z.string().min(1),
  updatedAt: z.coerce.date(),
})

export type ApproveJobInput = z.infer<typeof approveJobSchema>

export const rejectJobSchema = z.object({
  jobId: z.string().min(1),
  reviewNote: z.string().min(1).max(2000),
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
    select: { id: true, companyId: true, createdById: true, publishedAt: true },
  })
  if (!jobBase) throw new NotFoundError()

  await db.$transaction(async tx => {
    const result = await tx.job.updateMany({
      where: { id: input.jobId, status: 'PENDING_REVIEW', updatedAt: input.updatedAt },
      data: {
        status: 'PUBLISHED',
        publishedAt: jobBase.publishedAt ?? new Date(),
        reviewNote: null,
      },
    })

    if (result.count !== 1) {
      throw new ValidationError('职位已被修改或已处理，请刷新后再审')
    }

    await tx.company.update({
      where: { id: jobBase.companyId },
      data: { approvedJobCount: { increment: 1 } },
    })

    await createNotification(tx, jobBase.createdById, 'job.approved', {
      jobId: jobBase.id,
    })
  })

  await logAudit({
    actorId: userId,
    action: 'job.review',
    targetType: 'Job',
    targetId: jobBase.id,
    metadata: { decision: 'approved' },
  })
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
}
