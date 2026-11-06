import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { logAudit } from './audit'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { createNotification } from './notifications'
import type { UserCtx } from '../authz'

export const approveJobSchema = z.object({
  jobId: z.string().min(1),
})

export type ApproveJobInput = z.infer<typeof approveJobSchema>

export const rejectJobSchema = z.object({
  jobId: z.string().min(1),
  reviewNote: z.string().min(1).max(2000),
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

  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, status: true, companyId: true, createdById: true, publishedAt: true },
  })
  if (!job) throw new NotFoundError()
  if (job.status !== 'PENDING_REVIEW') {
    throw new ValidationError('Job is not in PENDING_REVIEW state')
  }

  await db.$transaction(async tx => {
    await tx.job.update({
      where: { id: job.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: job.publishedAt ?? new Date(),
        reviewNote: null,
      },
    })

    await tx.company.update({
      where: { id: job.companyId },
      data: { approvedJobCount: { increment: 1 } },
    })

    await createNotification(tx, job.createdById, 'job.approved', {
      jobId: job.id,
    })
  })

  await logAudit({
    actorId: userId,
    action: 'job.review',
    targetType: 'Job',
    targetId: job.id,
    metadata: { decision: 'approved' },
  })
}

export async function rejectJob(ctx: UserCtx, input: RejectJobInput): Promise<void> {
  const { userId } = ctx
  await assertAdminUser(userId)

  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, status: true, companyId: true, createdById: true },
  })
  if (!job) throw new NotFoundError()
  if (job.status !== 'PENDING_REVIEW') {
    throw new ValidationError('Job is not in PENDING_REVIEW state')
  }

  await db.$transaction(async tx => {
    await tx.job.update({
      where: { id: job.id },
      data: {
        status: 'REJECTED',
        reviewNote: input.reviewNote,
      },
    })

    await createNotification(tx, job.createdById, 'job.rejected', {
      jobId: job.id,
      reviewNote: input.reviewNote,
    })
  })

  await logAudit({
    actorId: userId,
    action: 'job.review',
    targetType: 'Job',
    targetId: job.id,
    metadata: { decision: 'rejected', reviewNote: input.reviewNote },
  })
}
