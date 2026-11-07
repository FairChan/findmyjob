import 'server-only'
import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { db } from '../db'
import { logAudit } from './audit'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { createCompanySchema } from './company'
import { jobFormSchema } from './jobs'
import { createWallet } from './credits'
import { grantPilotCreditsOnVerification } from '../jobs/pilot-monthly-credits'
import { logger } from '../lib/logger'
import type { UserCtx } from '../authz'

export type CreateManagedCompanyInput = z.infer<typeof createCompanySchema>
export type PostJobInput = z.infer<typeof jobFormSchema>

export const transferInputSchema = z.object({
  ownerEmail: z.string().email().max(255).toLowerCase(),
  verificationRecord: z.string().min(1).max(2000),
  verificationMethod: z.enum(['DOMAIN_MATCH', 'PHONE_CALLBACK']),
})
export type TransferInput = z.infer<typeof transferInputSchema>

function domainsMatch(websiteUrl: string, emailAddress: string): boolean {
  try {
    const websiteHostname = new URL(websiteUrl).hostname.toLowerCase()
    const emailDomain = emailAddress.split('@')[1]?.toLowerCase()
    if (!emailDomain) return false
    return websiteHostname === emailDomain || websiteHostname.endsWith('.' + emailDomain)
  } catch {
    return false
  }
}

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

  // Create wallet for managed company (same as the approval flow)
  await createWallet(company.id)

  await logAudit({
    actorId: ctx.userId,
    action: 'company.managed.create',
    targetType: 'Company',
    targetId: company.id,
    metadata: { legalName: company.legalName },
  })

  // Grant initial pilot credits (best-effort)
  await grantPilotCreditsOnVerification(company.id).catch(err => {
    logger.error({ err, companyId: company.id }, 'pilot-credits: managed company initial grant failed')
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
    select: { id: true, isManaged: true, isActive: true, legalName: true, website: true },
  })
  if (!company || !company.isActive) throw new NotFoundError()
  if (!company.isManaged) throw new ForbiddenError('Company is not managed by the platform')

  if (input.verificationMethod === 'DOMAIN_MATCH') {
    if (!company.website) {
      throw new ValidationError('Company has no website for domain match verification')
    }
    if (!domainsMatch(company.website, input.ownerEmail)) {
      throw new ValidationError('Owner email domain does not match company website domain')
    }
  }

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
      verificationMethod: input.verificationMethod,
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
  if (invite.role !== 'OWNER') throw new ForbiddenError('Only OWNER transfer invites can be accepted via this flow')

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
    // Revoke all other pending invites for this company in the same transaction
    await tx.companyInvite.updateMany({
      where: {
        companyId: invite.companyId,
        tokenHash: { not: hash },
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { expiresAt: new Date(0) },
    })
    // Conditional update prevents concurrent double-transfer
    const { count } = await tx.company.updateMany({
      where: { id: invite.companyId, isManaged: true },
      data: { isManaged: false },
    })
    if (count !== 1) throw new ValidationError('Company has already been transferred')
  })

  await logAudit({
    actorId: userId,
    action: 'company.managed.transfer',
    targetType: 'Company',
    targetId: invite.companyId,
    metadata: { phase: 'completed', inviteId: invite.id },
  })
  await logAudit({
    actorId: userId,
    action: 'company.invite.accept',
    targetType: 'Company',
    targetId: invite.companyId,
    metadata: { role: invite.role },
  })
}
