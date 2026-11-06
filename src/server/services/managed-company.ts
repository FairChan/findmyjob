import 'server-only'
import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { db } from '../db'
import { logAudit } from './audit'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { createCompanySchema } from './company'
import { jobFormSchema } from './jobs'
import type { UserCtx } from '../authz'

export type CreateManagedCompanyInput = z.infer<typeof createCompanySchema>
export type PostJobInput = z.infer<typeof jobFormSchema>

export const transferInputSchema = z.object({
  ownerEmail: z.string().email().max(255).toLowerCase(),
  verificationRecord: z.string().min(1).max(2000),
})
export type TransferInput = z.infer<typeof transferInputSchema>

async function assertAdmin(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!user || user.role !== 'ADMIN') throw new ForbiddenError()
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Creates a company managed by the platform.
 * The company is immediately marked as VERIFIED and isManaged=true.
 * The admin is NOT added as a CompanyMember — platform authorization is by
 * role='ADMIN' + isManaged check, allowing one admin to manage multiple companies.
 */
export async function createManagedCompany(
  ctx: UserCtx,
  input: CreateManagedCompanyInput,
) {
  await assertAdmin(ctx.userId)

  const company = await db.company.create({
    data: {
      legalName: input.legalName,
      displayNameZh: input.displayNameZh ?? null,
      displayNameEn: input.displayNameEn ?? null,
      ssmRegNo: input.ssmRegNo || null,
      industryCode: input.industryCode || null,
      size: input.size ?? null,
      website: input.website || null,
      state: input.state || null,
      city: input.city || null,
      address: input.address || null,
      description: input.description || null,
      isManaged: true,
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(),
    },
  })

  await logAudit({
    actorId: ctx.userId,
    action: 'company.managed.create',
    targetType: 'Company',
    targetId: company.id,
    metadata: { legalName: company.legalName },
  })

  return company
}

/**
 * Posts a job on behalf of a managed company, bypassing the review queue.
 * The job is published immediately regardless of approvedJobCount.
 */
export async function postJobAsPlatform(
  ctx: UserCtx,
  companyId: string,
  input: PostJobInput,
) {
  await assertAdmin(ctx.userId)

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, isManaged: true, isActive: true },
  })
  if (!company || !company.isActive) throw new NotFoundError()
  if (!company.isManaged) throw new ForbiddenError('Company is not managed by the platform')

  const { submit: _submit, deadline, ...fields } = input

  const job = await db.$transaction(async tx => {
    const j = await tx.job.create({
      data: {
        ...fields,
        companyId,
        createdById: ctx.userId,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        deadline: deadline ? new Date(deadline) : null,
      },
    })
    await tx.company.update({
      where: { id: companyId },
      data: { approvedJobCount: { increment: 1 } },
    })
    return j
  })

  await logAudit({
    actorId: ctx.userId,
    action: 'company.managed.post',
    targetType: 'Job',
    targetId: job.id,
    metadata: { companyId, title: job.title },
  })

  return job
}

/**
 * Initiates a managed company transfer by creating an invite token for the new owner.
 * verificationRecord is required and written into the audit log (TM-008).
 */
export async function transferCompany(
  ctx: UserCtx,
  companyId: string,
  input: TransferInput,
) {
  await assertAdmin(ctx.userId)

  if (!input.verificationRecord.trim()) {
    throw new ValidationError('Verification record is required for managed company transfer')
  }

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, isManaged: true, isActive: true, legalName: true },
  })
  if (!company || !company.isActive) throw new NotFoundError()
  if (!company.isManaged) throw new ForbiddenError('Company is not managed by the platform')

  const token = randomBytes(32).toString('base64url')
  const hash = tokenHash(token)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await db.companyInvite.create({
    data: {
      companyId,
      email: input.ownerEmail,
      role: 'OWNER',
      tokenHash: hash,
      expiresAt,
      createdById: ctx.userId,
    },
  })

  await logAudit({
    actorId: ctx.userId,
    action: 'company.managed.transfer',
    targetType: 'Company',
    targetId: companyId,
    metadata: {
      ownerEmail: input.ownerEmail,
      verificationRecord: input.verificationRecord,
      legalName: company.legalName,
    },
  })

  return { token }
}

/**
 * Completes a managed company transfer.
 * The new owner accepts the invite; in the same transaction the company is
 * marked isManaged=false and the new owner is added as OWNER member.
 */
export async function acceptManagedTransfer(ctx: UserCtx, token: string): Promise<void> {
  const { userId } = ctx

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true, role: true, status: true },
  })
  if (!user || user.status !== 'ACTIVE') throw new ForbiddenError()
  if (user.role !== 'EMPLOYER') throw new ForbiddenError('Only employer accounts can accept a transfer')
  if (!user.emailVerified) throw new ForbiddenError('Email must be verified to accept a transfer')

  const hash = tokenHash(token)
  const invite = await db.companyInvite.findUnique({
    where: { tokenHash: hash },
    include: { company: { select: { id: true, legalName: true, isActive: true, isManaged: true } } },
  })

  if (!invite) throw new NotFoundError('Transfer invite not found')
  if (invite.acceptedAt) throw new ValidationError('Invite already used')
  if (invite.expiresAt < new Date()) throw new ValidationError('Invite has expired')
  if (!invite.company.isActive) throw new ValidationError('Company is no longer active')
  if (!invite.company.isManaged) throw new ValidationError('Company has already been transferred')

  // Email must match (timing-safe comparison)
  const inviteEmailBuf = Buffer.from(invite.email.toLowerCase())
  const userEmailBuf = Buffer.from(user.email.toLowerCase())
  const emailsMatch =
    inviteEmailBuf.length === userEmailBuf.length &&
    timingSafeEqual(inviteEmailBuf, userEmailBuf)
  if (!emailsMatch) throw new ForbiddenError('Email does not match the invite')

  // MVP: one company per user
  const anyMembership = await db.companyMember.findFirst({
    where: { userId },
    select: { id: true },
  })
  if (anyMembership) throw new ValidationError('Already a member of a company')

  await db.$transaction(async tx => {
    await tx.companyInvite.update({
      where: { tokenHash: hash },
      data: { acceptedAt: new Date() },
    })
    await tx.companyMember.create({
      data: { companyId: invite.companyId, userId, role: 'OWNER' },
    })
    await tx.company.update({
      where: { id: invite.companyId },
      data: { isManaged: false },
    })
  })
}
