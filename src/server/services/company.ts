import 'server-only'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { logAudit } from './audit'
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { getAllIndustryCodes } from '../lib/taxonomy/industries'
import type { UserCtx, CompanyCtx } from '../authz'
import { deleteAllVersions } from '@/lib/storage'

const COMPANY_SIZES = ['S1_10', 'S11_50', 'S51_200', 'S201_1000', 'S1000_PLUS'] as const

export const createCompanySchema = z.object({
  legalName: z.string().min(2).max(200),
  displayNameZh: z.string().max(100).optional(),
  displayNameEn: z.string().max(100).optional(),
  ssmRegNo: z.string().max(50).optional(),
  industryCode: z
    .string()
    .optional()
    .refine(v => v === undefined || v === '' || getAllIndustryCodes().includes(v), {
      message: 'Invalid industry code',
    }),
  size: z.enum(COMPANY_SIZES).optional(),
  website: z.string().max(255).optional(),
  state: z.string().max(50).optional(),
  city: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
})

export type CreateCompanyInput = z.infer<typeof createCompanySchema>

export const updateCompanySchema = createCompanySchema.extend({
  logoKey: z.string().max(500).optional(),
})

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>

export async function createCompany(ctx: UserCtx, input: CreateCompanyInput) {
  const { userId } = ctx

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  if (!user || user.role !== 'EMPLOYER') throw new ForbiddenError()

  // MVP: one company per employer
  const existing = await db.companyMember.findFirst({
    where: { userId },
    select: { id: true },
  })
  if (existing) throw new ValidationError('Already a member of a company')

  // SSM uniqueness (soft-check; db constraint is the source of truth)
  if (input.ssmRegNo) {
    const dup = await db.company.findUnique({
      where: { ssmRegNo: input.ssmRegNo },
      select: { id: true },
    })
    if (dup) throw new ValidationError('SSM registration number already in use')
  }

  let company: Awaited<ReturnType<typeof db.company.create>>
  try {
    company = await db.$transaction(async tx => {
      const c = await tx.company.create({
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
        },
      })

      await tx.companyMember.create({
        data: { companyId: c.id, userId, role: 'OWNER' },
      })

      return c
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ValidationError('Already a member of a company')
    }
    throw err
  }

  await logAudit({
    actorId: userId,
    action: 'company.create',
    targetType: 'Company',
    targetId: company.id,
    metadata: { legalName: company.legalName },
  })

  return company
}

export function isOwnLogoKey(companyId: string, key: string): boolean {
  return key.startsWith(`logos/${companyId}/`)
}

export async function updateCompany(ctx: CompanyCtx, input: UpdateCompanyInput) {
  const { userId, companyId } = ctx

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      ssmRegNo: true,
      logoKey: true,
      verificationStatus: true,
      legalName: true,
      displayNameZh: true,
      displayNameEn: true,
    },
  })
  if (!company) throw new NotFoundError()

  // Once PENDING or VERIFIED, identity fields are locked to prevent impersonation (TM-006)
  if (company.verificationStatus === 'PENDING' || company.verificationStatus === 'VERIFIED') {
    const changed =
      input.legalName !== company.legalName ||
      (input.ssmRegNo ?? null) !== (company.ssmRegNo ?? null) ||
      (input.displayNameZh ?? null) !== (company.displayNameZh ?? null) ||
      (input.displayNameEn ?? null) !== (company.displayNameEn ?? null)
    if (changed) {
      throw new AppError(
        'Identity fields cannot be changed after verification has been submitted',
        'IDENTITY_LOCKED',
        422,
      )
    }
  }

  // SSM uniqueness: only check if value changed
  if (input.ssmRegNo && input.ssmRegNo !== company.ssmRegNo) {
    const dup = await db.company.findUnique({
      where: { ssmRegNo: input.ssmRegNo },
      select: { id: true },
    })
    if (dup && dup.id !== companyId) {
      throw new ValidationError('SSM registration number already in use')
    }
  }

  // logoKey must belong to this company (server-generated key prefix)
  if (input.logoKey) {
    if (!isOwnLogoKey(companyId, input.logoKey)) {
      throw new ForbiddenError('Logo key does not belong to this company')
    }
  }

  // Delete old logo when it changes
  if (
    input.logoKey !== undefined &&
    company.logoKey &&
    input.logoKey !== company.logoKey
  ) {
    await deleteAllVersions(company.logoKey).catch(() => {})
  }

  const updated = await db.company.update({
    where: { id: companyId },
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
      ...(input.logoKey !== undefined ? { logoKey: input.logoKey || null } : {}),
    },
  })

  await logAudit({
    actorId: userId,
    action: 'company.update',
    targetType: 'Company',
    targetId: companyId,
    metadata: { legalName: updated.legalName },
  })

  return updated
}

export async function getMyCompany(ctx: UserCtx) {
  const member = await db.companyMember.findFirst({
    where: { userId: ctx.userId },
    include: { company: true },
  })
  return member?.company ?? null
}

export async function getPublicCompany(id: string) {
  return db.company.findFirst({
    where: { id, verificationStatus: 'VERIFIED', isActive: true },
    select: {
      id: true,
      legalName: true,
      displayNameZh: true,
      displayNameEn: true,
      description: true,
      website: true,
      logoKey: true,
      state: true,
      city: true,
      industryCode: true,
      size: true,
      isFoundingPartner: true,
    },
  })
}
