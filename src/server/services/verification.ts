import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { logAudit } from './audit'
import { ForbiddenError, ValidationError } from '../errors'
import type { CompanyCtx } from '../authz'

export const submitVerificationSchema = z.object({
  documentKeys: z.array(z.string().min(1).max(500)).min(1).max(5),
  note: z.string().max(500).optional(),
})

export type SubmitVerificationInput = z.infer<typeof submitVerificationSchema>

export async function submitVerification(ctx: CompanyCtx, input: SubmitVerificationInput) {
  const { userId, companyId } = ctx

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  })
  if (!company) throw new ForbiddenError()

  // Deduplicate keys before validation
  const uniqueKeys = [...new Set(input.documentKeys)]

  // documentKeys must belong to this company (server-generated key prefix)
  const prefix = `verifications/${companyId}/`
  for (const key of uniqueKeys) {
    if (!key.startsWith(prefix)) {
      throw new ForbiddenError()
    }
  }

  await db.$transaction(async tx => {
    // Atomic status check: only update if not already PENDING or VERIFIED
    const result = await tx.company.updateMany({
      where: {
        id: companyId,
        verificationStatus: { notIn: ['PENDING', 'VERIFIED'] },
      },
      data: { verificationStatus: 'PENDING' },
    })

    if (result.count === 0) {
      // Find out which terminal state caused the rejection for a specific error message
      const co = await tx.company.findUnique({
        where: { id: companyId },
        select: { verificationStatus: true },
      })
      if (co?.verificationStatus === 'VERIFIED') {
        throw new ValidationError('Company already verified')
      }
      throw new ValidationError('Verification already pending')
    }

    await tx.companyVerification.create({
      data: {
        companyId,
        documentKeys: uniqueKeys,
        note: input.note ?? null,
        status: 'PENDING',
        submittedById: userId,
      },
    })
  })

  await logAudit({
    actorId: userId,
    action: 'company.verification.submit',
    targetType: 'Company',
    targetId: companyId,
    metadata: { fileCount: input.documentKeys.length },
  })
}

export async function getVerificationInfo(ctx: CompanyCtx) {
  const { companyId } = ctx

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { verificationStatus: true },
  })

  const latest = await db.companyVerification.findFirst({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      reviewNote: true,
      createdAt: true,
      reviewedAt: true,
      documentKeys: true,
    },
  })

  return {
    status: company?.verificationStatus ?? 'UNSUBMITTED',
    latest,
  }
}
