import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { logAudit } from './audit'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
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

  const company = await db.$transaction(async tx => {
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

  await logAudit({
    actorId: userId,
    action: 'company.create',
    targetType: 'Company',
    targetId: company.id,
    metadata: { legalName: company.legalName },
  })

  return company
}

export async function updateCompany(ctx: CompanyCtx, input: UpdateCompanyInput) {
  const { userId, companyId } = ctx

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, ssmRegNo: true, logoKey: true },
  })
  if (!company) throw new NotFoundError()

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
