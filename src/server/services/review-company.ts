import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { logAudit } from './audit'
import { createWallet } from './credits'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { createNotification } from './notifications'
import { grantPilotCreditsOnVerification } from './pilot-credits'
import { logger } from '../lib/logger'
import type { UserCtx } from '../authz'

async function assertAdminUser(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!user || user.role !== 'ADMIN') throw new ForbiddenError()
}

export const REVIEW_CHANNELS = ['SSM', 'WEBSITE', 'PHONE'] as const
export type ReviewChannel = (typeof REVIEW_CHANNELS)[number]

export const approveCompanySchema = z.object({
  verificationId: z.string().min(1),
  verifiedChannels: z.array(z.enum(REVIEW_CHANNELS)).min(1),
  verificationResult: z.string().trim().min(1).max(2000),
})

export type ApproveCompanyInput = z.infer<typeof approveCompanySchema>

export const rejectCompanySchema = z.object({
  verificationId: z.string().min(1),
  reviewNote: z.string().trim().min(1).max(2000),
})

export type RejectCompanyInput = z.infer<typeof rejectCompanySchema>

export async function approveCompany(ctx: UserCtx, input: ApproveCompanyInput): Promise<void> {
  const { userId } = ctx

  if (input.verifiedChannels.length === 0) {
    throw new ValidationError('At least one verification channel is required')
  }

  const cv = await db.companyVerification.findUnique({
    where: { id: input.verificationId },
    select: { id: true, companyId: true },
  })
  if (!cv) throw new NotFoundError()

  const channelLabel = input.verifiedChannels.join(', ')
  const reviewNote = `核实渠道：${channelLabel}；核实结果：${input.verificationResult}`

  const owner = await db.companyMember.findFirst({
    where: { companyId: cv.companyId, role: 'OWNER' },
    select: { userId: true },
  })

  await db.$transaction(async tx => {
    // Conditional update — only proceeds if the verification is still PENDING,
    // preventing concurrent approvals from both succeeding.
    const updated = await tx.companyVerification.updateMany({
      where: { id: cv.id, status: 'PENDING' },
      data: {
        status: 'VERIFIED',
        reviewerId: userId,
        reviewNote,
        reviewedAt: new Date(),
      },
    })
    if (updated.count === 0) throw new ValidationError('Verification is not in PENDING state')

    await tx.company.update({
      where: { id: cv.companyId },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
      },
    })

    await createWallet(tx, cv.companyId)

    if (owner) {
      await createNotification(tx, owner.userId, 'company.verified', {
        companyId: cv.companyId,
      })
    }
  })

  await logAudit({
    actorId: userId,
    action: 'company.verify',
    targetType: 'Company',
    targetId: cv.companyId,
    metadata: {
      verificationId: cv.id,
      channels: input.verifiedChannels,
      verificationResult: input.verificationResult,
      reviewNote,
    },
  })

  // Grant initial pilot credits immediately (best-effort; monthly job picks up any gaps)
  await grantPilotCreditsOnVerification(cv.companyId).catch(err => {
    logger.error({ err, companyId: cv.companyId }, 'pilot-credits: immediate grant failed')
  })

  // Email notification enqueued in M5-T08
  if (owner) {
    await enqueueVerificationEmail(cv.companyId, owner.userId, 'VERIFIED').catch(() => {})
  }
}

export async function rejectCompany(ctx: UserCtx, input: RejectCompanyInput): Promise<void> {
  const { userId } = ctx

  const cv = await db.companyVerification.findUnique({
    where: { id: input.verificationId },
    select: { id: true, companyId: true },
  })
  if (!cv) throw new NotFoundError()

  const owner = await db.companyMember.findFirst({
    where: { companyId: cv.companyId, role: 'OWNER' },
    select: { userId: true },
  })

  await db.$transaction(async tx => {
    // Conditional update — prevents concurrent approvals racing with this rejection.
    const updated = await tx.companyVerification.updateMany({
      where: { id: cv.id, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        reviewerId: userId,
        reviewNote: input.reviewNote,
        reviewedAt: new Date(),
      },
    })
    if (updated.count === 0) throw new ValidationError('Verification is not in PENDING state')

    await tx.company.update({
      where: { id: cv.companyId },
      data: { verificationStatus: 'REJECTED' },
    })

    if (owner) {
      await createNotification(tx, owner.userId, 'company.rejected', {
        companyId: cv.companyId,
        reviewNote: input.reviewNote,
      })
    }
  })

  await logAudit({
    actorId: userId,
    action: 'company.reject',
    targetType: 'Company',
    targetId: cv.companyId,
    metadata: {
      verificationId: cv.id,
      reviewNote: input.reviewNote,
    },
  })

  if (owner) {
    await enqueueVerificationEmail(cv.companyId, owner.userId, 'REJECTED').catch(() => {})
  }
}

export async function listPendingVerifications(ctx: UserCtx) {
  await assertAdminUser(ctx.userId)
  return db.company.findMany({
    where: { verificationStatus: 'PENDING' },
    include: {
      verifications: {
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'asc' },
  })
}

export async function getCompanyForReview(ctx: UserCtx, companyId: string) {
  await assertAdminUser(ctx.userId)
  return db.company.findUnique({
    where: { id: companyId },
    include: {
      verifications: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      members: {
        where: { role: 'OWNER' },
        include: { user: { select: { email: true, name: true } } },
        take: 1,
      },
    },
  })
}

async function enqueueVerificationEmail(
  companyId: string,
  ownerId: string,
  status: 'VERIFIED' | 'REJECTED',
): Promise<void> {
  const { sendNotificationEmail } = await import('./notify')
  // Fetch review note for rejections
  let reviewNote: string | undefined
  if (status === 'REJECTED') {
    const cv = await db.companyVerification.findFirst({
      where: { companyId, status: 'REJECTED' },
      orderBy: { reviewedAt: 'desc' },
      select: { reviewNote: true },
    })
    reviewNote = cv?.reviewNote ?? undefined
  }
  await sendNotificationEmail(ownerId, {
    template: 'company-verification',
    approved: status === 'VERIFIED',
    reviewNote,
  })
}
