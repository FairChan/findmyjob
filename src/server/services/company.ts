import 'server-only'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { logAudit } from './audit'
import { AppError, ForbiddenError, NotFoundError } from '../errors'
import { getAllIndustryCodes } from '../lib/taxonomy/industries'
import type { UserCtx, CompanyCtx } from '../authz'
import { deleteAllVersions } from '@/lib/storage'
import { logger } from '../lib/logger'
import { normalizeWebsiteInput } from '@/lib/url-utils'

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
  // "abc.com.my" is what people type; it is stored as https://abc.com.my.
  website: z.preprocess(
    v => (typeof v === 'string' ? normalizeWebsiteInput(v) : v),
    z
      .string()
      .max(255)
      .optional()
      .refine(v => v === undefined || /^https?:\/\/\S+$/i.test(v), {
        message: 'Website must start with http:// or https://',
      }),
  ),
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
  if (existing) throw new AppError('Already a member of a company', 'ALREADY_MEMBER', 422)

  // Normalize SSM: trim whitespace and uppercase (server-side canonical form)
  const ssmRegNo = input.ssmRegNo ? input.ssmRegNo.trim().toUpperCase() : undefined

  // SSM uniqueness (soft-check; db constraint is the source of truth)
  if (ssmRegNo) {
    const dup = await db.company.findUnique({
      where: { ssmRegNo },
      select: { id: true },
    })
    if (dup) throw new AppError('SSM registration number already in use', 'SSM_DUPLICATE', 422)
  }

  let company: Awaited<ReturnType<typeof db.company.create>>
  try {
    company = await db.$transaction(async tx => {
      const c = await tx.company.create({
        data: {
          legalName: input.legalName,
          displayNameZh: input.displayNameZh ?? null,
          displayNameEn: input.displayNameEn ?? null,
          ssmRegNo: ssmRegNo || null,
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
      // P2002 on ssmRegNo unique constraint (concurrent insert)
      const target = (err.meta?.target as string[] | undefined) ?? []
      if (target.includes('ssmRegNo')) {
        throw new AppError('SSM registration number already in use', 'SSM_DUPLICATE', 422)
      }
      throw new AppError('Already a member of a company', 'ALREADY_MEMBER', 422)
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

  // Normalize SSM: trim and uppercase
  const ssmRegNo = input.ssmRegNo ? input.ssmRegNo.trim().toUpperCase() : undefined

  // Once PENDING or VERIFIED, identity fields are locked to prevent impersonation (TM-006)
  if (company.verificationStatus === 'PENDING' || company.verificationStatus === 'VERIFIED') {
    const changed =
      input.legalName !== company.legalName ||
      (ssmRegNo ?? null) !== (company.ssmRegNo ?? null) ||
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
  if (ssmRegNo && ssmRegNo !== company.ssmRegNo) {
    const dup = await db.company.findUnique({
      where: { ssmRegNo },
      select: { id: true },
    })
    if (dup && dup.id !== companyId) {
      throw new AppError('SSM registration number already in use', 'SSM_DUPLICATE', 422)
    }
  }

  // logoKey must belong to this company (server-generated key prefix)
  if (input.logoKey) {
    if (!isOwnLogoKey(companyId, input.logoKey)) {
      throw new ForbiddenError('Logo key does not belong to this company')
    }
  }

  const oldLogoKey =
    input.logoKey !== undefined && company.logoKey && input.logoKey !== company.logoKey
      ? company.logoKey
      : null

  const updated = await db.company.update({
    where: { id: companyId },
    data: {
      legalName: input.legalName,
      displayNameZh: input.displayNameZh ?? null,
      displayNameEn: input.displayNameEn ?? null,
      ssmRegNo: ssmRegNo || null,
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

  // Delete old logo after DB is committed to avoid data loss if DB update fails
  if (oldLogoKey) {
    await deleteAllVersions(oldLogoKey).catch(err =>
      logger.error({ err }, 'Failed to delete old logo'),
    )
  }

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

const PUBLIC_COMPANY_PAGE_SIZE = 24

export async function listPublicCompanies(input: {
  tag?: import('@prisma/client').CompanyTag
  cursor?: string
}) {
  const now = new Date()
  const companies = await db.company.findMany({
    where: {
      verificationStatus: 'VERIFIED',
      isActive: true,
      ...(input.tag ? { tags: { has: input.tag } } : {}),
      ...(input.cursor ? { id: { gt: input.cursor } } : {}),
    },
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
      tags: true,
      _count: {
        select: {
          jobs: {
            where: {
              status: 'PUBLISHED',
              OR: [{ deadline: null }, { deadline: { gte: now } }],
            },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
    take: PUBLIC_COMPANY_PAGE_SIZE + 1,
  })

  const hasMore = companies.length > PUBLIC_COMPANY_PAGE_SIZE
  const raw = hasMore ? companies.slice(0, PUBLIC_COMPANY_PAGE_SIZE) : companies
  const items = raw.map(({ _count, ...rest }) => ({
    ...rest,
    publishedJobCount: _count.jobs,
  }))
  const nextCursor = hasMore ? items[items.length - 1].id : null

  return { items, nextCursor }
}
