import 'server-only'
import { z } from 'zod'
import { CompanyTag, VerificationStatus } from '@prisma/client'
import { db } from '../db'
import { ForbiddenError, NotFoundError } from '../errors'
import { logAudit } from './audit'
import { adminAdjust } from './credits'
import { COMPANY_TAGS } from '@/lib/company-tags'
import type { UserCtx } from '../authz'

async function assertAdmin(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  })
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
    throw new ForbiddenError()
  }
}

// ---- Search ----------------------------------------------------------------

export const searchCompaniesSchema = z.object({
  q: z.string().max(200).optional(),
  isActive: z.boolean().optional(),
  verificationStatus: z.nativeEnum(VerificationStatus).optional(),
  page: z.number().int().min(1).default(1),
})

export type SearchCompaniesInput = z.infer<typeof searchCompaniesSchema>

export interface CompanyListItem {
  id: string
  legalName: string
  verificationStatus: string
  isActive: boolean
  isFoundingPartner: boolean
  createdAt: Date
  memberCount: number
  walletBalance: number | null
}

export async function searchCompanies(
  ctx: UserCtx,
  input: SearchCompaniesInput,
): Promise<{ items: CompanyListItem[]; total: number }> {
  await assertAdmin(ctx.userId)

  const { q, isActive, verificationStatus, page } = searchCompaniesSchema.parse(input)
  const pageSize = 20
  const skip = (page - 1) * pageSize

  const escaped = q
    ? q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    : undefined

  const where = {
    ...(isActive !== undefined ? { isActive } : {}),
    ...(verificationStatus !== undefined ? { verificationStatus } : {}),
    ...(escaped
      ? {
          OR: [
            { legalName: { contains: escaped, mode: 'insensitive' as const } },
            { displayNameZh: { contains: escaped, mode: 'insensitive' as const } },
            { displayNameEn: { contains: escaped, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  // PENDING queue: oldest submissions first so reviewers see the most waiting longest
  const orderBy =
    verificationStatus === 'PENDING'
      ? { createdAt: 'asc' as const }
      : { createdAt: 'desc' as const }

  const [companies, total] = await Promise.all([
    db.company.findMany({
      where,
      include: {
        _count: { select: { members: true } },
        wallet: { select: { balance: true } },
      },
      orderBy,
      skip,
      take: pageSize,
    }),
    db.company.count({ where }),
  ])

  const items: CompanyListItem[] = companies.map((c) => ({
    id: c.id,
    legalName: c.legalName,
    verificationStatus: c.verificationStatus,
    isActive: c.isActive,
    isFoundingPartner: c.isFoundingPartner,
    createdAt: c.createdAt,
    memberCount: c._count.members,
    walletBalance: c.wallet?.balance ?? null,
  }))

  return { items, total }
}

// ---- Detail ----------------------------------------------------------------

export interface CompanyAdminDetail {
  id: string
  legalName: string
  displayNameZh: string | null
  displayNameEn: string | null
  ssmRegNo: string | null
  website: string | null
  verificationStatus: string
  isActive: boolean
  isFoundingPartner: boolean
  isManaged: boolean
  tags: CompanyTag[]
  createdAt: Date
  walletBalance: number | null
  memberCount: number
  ownerEmail: string | null
}

export async function getCompanyAdminDetail(
  ctx: UserCtx,
  companyId: string,
): Promise<CompanyAdminDetail> {
  await assertAdmin(ctx.userId)

  const company = await db.company.findUnique({
    where: { id: companyId },
    include: {
      wallet: { select: { balance: true } },
      _count: { select: { members: true } },
      members: {
        where: { role: 'OWNER' },
        include: { user: { select: { email: true } } },
        take: 1,
      },
    },
  })

  if (!company) throw new NotFoundError('Company not found')

  return {
    id: company.id,
    legalName: company.legalName,
    displayNameZh: company.displayNameZh,
    displayNameEn: company.displayNameEn,
    ssmRegNo: company.ssmRegNo,
    website: company.website,
    verificationStatus: company.verificationStatus,
    isActive: company.isActive,
    isFoundingPartner: company.isFoundingPartner,
    isManaged: company.isManaged,
    tags: company.tags,
    createdAt: company.createdAt,
    walletBalance: company.wallet?.balance ?? null,
    memberCount: company._count.members,
    ownerEmail: company.members[0]?.user.email ?? null,
  }
}

// ---- Deactivate / Reactivate -----------------------------------------------

export const deactivateCompanySchema = z.object({
  companyId: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
})

export type DeactivateCompanyInput = z.infer<typeof deactivateCompanySchema>

export async function deactivateCompany(
  ctx: UserCtx,
  input: DeactivateCompanyInput,
): Promise<void> {
  await assertAdmin(ctx.userId)
  const { companyId, reason } = deactivateCompanySchema.parse(input)

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, isActive: true },
  })
  if (!company) throw new NotFoundError('Company not found')
  if (!company.isActive) return

  await db.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: companyId },
      data: { isActive: false },
    })

    const members = await tx.companyMember.findMany({
      where: { companyId },
      select: { userId: true },
    })
    const memberIds = members.map((m) => m.userId)

    if (memberIds.length > 0) {
      await tx.session.deleteMany({ where: { userId: { in: memberIds } } })
      await logAudit(
        {
          actorId: ctx.userId,
          action: 'auth.session.revoke',
          targetType: 'Company',
          targetId: companyId,
          metadata: { userIds: memberIds },
        },
        tx,
      )
    }

    await logAudit(
      {
        actorId: ctx.userId,
        action: 'company.deactivate',
        targetType: 'Company',
        targetId: companyId,
        metadata: { reason },
      },
      tx,
    )
  })
}

export const reactivateCompanySchema = z.object({
  companyId: z.string().min(1),
})

export type ReactivateCompanyInput = z.infer<typeof reactivateCompanySchema>

export async function reactivateCompany(
  ctx: UserCtx,
  input: ReactivateCompanyInput,
): Promise<void> {
  await assertAdmin(ctx.userId)
  const { companyId } = reactivateCompanySchema.parse(input)

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, isActive: true },
  })
  if (!company) throw new NotFoundError('Company not found')
  if (company.isActive) return

  await db.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: companyId },
      data: { isActive: true },
    })

    await logAudit(
      {
        actorId: ctx.userId,
        action: 'company.reactivate',
        targetType: 'Company',
        targetId: companyId,
        metadata: {},
      },
      tx,
    )
  })
}

// ---- Founding partner -------------------------------------------------------

export const setFoundingPartnerSchema = z.object({
  companyId: z.string().min(1),
  isFoundingPartner: z.boolean(),
})

export type SetFoundingPartnerInput = z.infer<typeof setFoundingPartnerSchema>

export async function setFoundingPartner(
  ctx: UserCtx,
  input: SetFoundingPartnerInput,
): Promise<void> {
  await assertAdmin(ctx.userId)
  const { companyId, isFoundingPartner } = setFoundingPartnerSchema.parse(input)

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  })
  if (!company) throw new NotFoundError('Company not found')

  await db.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: companyId },
      data: { isFoundingPartner },
    })

    await logAudit(
      {
        actorId: ctx.userId,
        action: 'company.founding_partner',
        targetType: 'Company',
        targetId: companyId,
        metadata: { isFoundingPartner },
      },
      tx,
    )
  })
}

// ---- Tags -------------------------------------------------------------------

export { COMPANY_TAGS }

export const setCompanyTagsSchema = z.object({
  companyId: z.string().min(1),
  tags: z.array(z.enum(COMPANY_TAGS)).max(7),
})

export type SetCompanyTagsInput = z.infer<typeof setCompanyTagsSchema>

export async function setCompanyTags(
  ctx: UserCtx,
  input: SetCompanyTagsInput,
): Promise<void> {
  await assertAdmin(ctx.userId)
  const { companyId, tags } = setCompanyTagsSchema.parse(input)

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  })
  if (!company) throw new NotFoundError('Company not found')

  await db.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: companyId },
      data: { tags: tags as CompanyTag[] },
    })

    await logAudit(
      {
        actorId: ctx.userId,
        action: 'company.tags_update',
        targetType: 'Company',
        targetId: companyId,
        metadata: { tags },
      },
      tx,
    )
  })
}

// ---- Credit adjustment -------------------------------------------------------

export const adjustCompanyCreditsSchema = z.object({
  companyId: z.string().min(1),
  delta: z
    .number()
    .int()
    .min(-100000)
    .max(100000)
    .refine((d) => d !== 0, { message: 'Delta must not be zero' }),
  note: z.string().trim().min(1).max(500),
})

export type AdjustCompanyCreditsInput = z.infer<typeof adjustCompanyCreditsSchema>

export async function adjustCompanyCredits(
  ctx: UserCtx,
  input: AdjustCompanyCreditsInput,
): Promise<{ balanceAfter: number }> {
  await assertAdmin(ctx.userId)
  const { companyId, delta, note } = adjustCompanyCreditsSchema.parse(input)

  const company = await db.company.findUnique({
    where: { id: companyId },
    include: { wallet: { select: { id: true } } },
  })
  if (!company) throw new NotFoundError('Company not found')
  if (!company.wallet) throw new NotFoundError('Company has no wallet (created on verification)')

  return adminAdjust({ actorId: ctx.userId }, { companyId, delta, note })
}
