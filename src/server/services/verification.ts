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
    select: { id: true, verificationStatus: true },
  })
  if (!company) throw new ForbiddenError()

  if (company.verificationStatus === 'PENDING') {
    throw new ValidationError('Verification already pending')
  }
  if (company.verificationStatus === 'VERIFIED') {
    throw new ValidationError('Company already verified')
  }

  // documentKeys must belong to this company (server-generated key prefix)
  const prefix = `verifications/${companyId}/`
  for (const key of input.documentKeys) {
    if (!key.startsWith(prefix)) {
      throw new ForbiddenError()
    }
  }

  await db.$transaction(async tx => {
    await tx.companyVerification.create({
      data: {
        companyId,
        documentKeys: input.documentKeys,
        note: input.note ?? null,
        status: 'PENDING',
        submittedById: userId,
      },
    })
    await tx.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'PENDING' },
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
