import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { ForbiddenError, NotFoundError } from '../errors'
import { logAudit } from './audit'
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

// ==================== School schemas ====================

export const createSchoolSchema = z.object({
  nameZh: z.string().min(1).max(200),
  nameEn: z.string().min(1).max(200),
  shortName: z.string().max(50).optional(),
  country: z.string().length(2).default('MY'),
  state: z.string().max(50).optional(),
  emailDomains: z.array(z.string().max(100)).min(1),
  isPartner: z.boolean().default(false),
})

export const updateSchoolSchema = z.object({
  nameZh: z.string().min(1).max(200).optional(),
  nameEn: z.string().min(1).max(200).optional(),
  shortName: z.string().max(50).optional(),
  country: z.string().length(2).optional(),
  state: z.string().max(50).optional(),
  emailDomains: z.array(z.string().max(100)).min(1).optional(),
  isPartner: z.boolean().optional(),
  active: z.boolean().optional(),
})

export type CreateSchoolInput = z.infer<typeof createSchoolSchema>
export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>

export interface SchoolListItem {
  id: string
  nameZh: string
  nameEn: string
  shortName: string | null
  country: string
  state: string | null
  emailDomains: string[]
  isPartner: boolean
  active: boolean
  studentCount: number
  createdAt: Date
}

// ==================== Partner schemas ====================

export const PARTNER_TYPES = ['SCHOOL', 'ALUMNI_ASSOCIATION', 'SOE', 'ENTERPRISE', 'GOVERNMENT', 'NGO'] as const

export const createPartnerSchema = z.object({
  name: z.string().min(1).max(200),
  nameEn: z.string().max(200).optional(),
  type: z.enum(PARTNER_TYPES),
  logoKey: z.string().max(500).optional(),
  website: z.string().url().max(500).or(z.literal('')).optional(),
  description: z.string().max(2000).optional(),
  showOnHome: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
})

export const updatePartnerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameEn: z.string().max(200).optional(),
  type: z.enum(PARTNER_TYPES).optional(),
  logoKey: z.string().max(500).optional(),
  website: z.string().url().max(500).or(z.literal('')).optional(),
  description: z.string().max(2000).optional(),
  showOnHome: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
})

export type CreatePartnerInput = z.infer<typeof createPartnerSchema>
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>

export interface PartnerListItem {
  id: string
  name: string
  nameEn: string | null
  type: string
  logoKey: string | null
  website: string | null
  description: string | null
  showOnHome: boolean
  sortOrder: number
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

// ==================== School CRUD ====================

export async function listSchools(
  ctx: UserCtx,
  input: { q?: string; active?: boolean } = {},
): Promise<SchoolListItem[]> {
  await assertAdmin(ctx.userId)

  const { q, active } = input
  const escaped = q
    ? q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    : undefined

  const schools = await db.school.findMany({
    where: {
      ...(active !== undefined ? { active } : {}),
      ...(escaped
        ? {
            OR: [
              { nameZh: { contains: escaped, mode: 'insensitive' as const } },
              { nameEn: { contains: escaped, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    include: {
      _count: { select: { students: true } },
    },
    orderBy: [{ active: 'desc' }, { nameZh: 'asc' }],
  })

  return schools.map((s) => ({
    id: s.id,
    nameZh: s.nameZh,
    nameEn: s.nameEn,
    shortName: s.shortName,
    country: s.country,
    state: s.state,
    emailDomains: s.emailDomains,
    isPartner: s.isPartner,
    active: s.active,
    studentCount: s._count.students,
    createdAt: s.createdAt,
  }))
}

export async function getSchool(
  ctx: UserCtx,
  id: string,
): Promise<SchoolListItem> {
  await assertAdmin(ctx.userId)

  const school = await db.school.findUnique({
    where: { id },
    include: { _count: { select: { students: true } } },
  })
  if (!school) throw new NotFoundError()

  return {
    id: school.id,
    nameZh: school.nameZh,
    nameEn: school.nameEn,
    shortName: school.shortName,
    country: school.country,
    state: school.state,
    emailDomains: school.emailDomains,
    isPartner: school.isPartner,
    active: school.active,
    studentCount: school._count.students,
    createdAt: school.createdAt,
  }
}

export async function createSchool(
  ctx: UserCtx,
  rawInput: CreateSchoolInput,
): Promise<{ id: string }> {
  await assertAdmin(ctx.userId)

  const input = createSchoolSchema.parse(rawInput)
  const school = await db.school.create({
    data: {
      nameZh: input.nameZh,
      nameEn: input.nameEn,
      shortName: input.shortName,
      country: input.country,
      state: input.state,
      emailDomains: input.emailDomains,
      isPartner: input.isPartner,
      active: true,
    },
    select: { id: true },
  })

  await logAudit({
    actorId: ctx.userId,
    action: 'school.create',
    targetType: 'School',
    targetId: school.id,
    metadata: { nameZh: input.nameZh, emailDomains: input.emailDomains },
  })

  return { id: school.id }
}

export async function updateSchool(
  ctx: UserCtx,
  id: string,
  rawInput: UpdateSchoolInput,
): Promise<void> {
  await assertAdmin(ctx.userId)

  const existing = await db.school.findUnique({ where: { id }, select: { id: true } })
  if (!existing) throw new NotFoundError()

  const input = updateSchoolSchema.parse(rawInput)

  await db.school.update({
    where: { id },
    data: {
      ...(input.nameZh !== undefined ? { nameZh: input.nameZh } : {}),
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
      ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.emailDomains !== undefined ? { emailDomains: input.emailDomains } : {}),
      ...(input.isPartner !== undefined ? { isPartner: input.isPartner } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  })

  await logAudit({
    actorId: ctx.userId,
    action: 'school.update',
    targetType: 'School',
    targetId: id,
    metadata: input,
  })
}

// ==================== Partner CRUD ====================

export async function listPartners(
  ctx: UserCtx,
  input: { q?: string } = {},
): Promise<PartnerListItem[]> {
  await assertAdmin(ctx.userId)

  const { q } = input
  const escaped = q
    ? q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    : undefined

  return db.partner.findMany({
    where: escaped
      ? {
          OR: [
            { name: { contains: escaped, mode: 'insensitive' as const } },
            { nameEn: { contains: escaped, mode: 'insensitive' as const } },
          ],
        }
      : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
}

export async function getPartner(
  ctx: UserCtx,
  id: string,
): Promise<PartnerListItem> {
  await assertAdmin(ctx.userId)

  const partner = await db.partner.findUnique({ where: { id } })
  if (!partner) throw new NotFoundError()

  return partner
}

export async function createPartner(
  ctx: UserCtx,
  rawInput: CreatePartnerInput,
): Promise<{ id: string }> {
  await assertAdmin(ctx.userId)

  const input = createPartnerSchema.parse(rawInput)
  const partner = await db.partner.create({
    data: {
      name: input.name,
      nameEn: input.nameEn,
      type: input.type,
      logoKey: input.logoKey,
      website: input.website || null,
      description: input.description,
      showOnHome: input.showOnHome,
      sortOrder: input.sortOrder,
      notes: input.notes,
    },
    select: { id: true },
  })

  await logAudit({
    actorId: ctx.userId,
    action: 'partner.create',
    targetType: 'Partner',
    targetId: partner.id,
    metadata: { name: input.name, type: input.type },
  })

  return { id: partner.id }
}

export async function updatePartner(
  ctx: UserCtx,
  id: string,
  rawInput: UpdatePartnerInput,
): Promise<void> {
  await assertAdmin(ctx.userId)

  const existing = await db.partner.findUnique({ where: { id }, select: { id: true } })
  if (!existing) throw new NotFoundError()

  const input = updatePartnerSchema.parse(rawInput)

  await db.partner.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.logoKey !== undefined ? { logoKey: input.logoKey } : {}),
      ...(input.website !== undefined ? { website: input.website || null } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.showOnHome !== undefined ? { showOnHome: input.showOnHome } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  })

  await logAudit({
    actorId: ctx.userId,
    action: 'partner.update',
    targetType: 'Partner',
    targetId: id,
    metadata: { name: input.name, showOnHome: input.showOnHome, sortOrder: input.sortOrder },
  })
}

export async function deletePartner(
  ctx: UserCtx,
  id: string,
): Promise<void> {
  await assertAdmin(ctx.userId)

  const existing = await db.partner.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!existing) throw new NotFoundError()

  await db.partner.delete({ where: { id } })

  await logAudit({
    actorId: ctx.userId,
    action: 'partner.delete',
    targetType: 'Partner',
    targetId: id,
    metadata: { name: existing.name },
  })
}

// ==================== Public (no auth) ====================

export async function getHomePartners(): Promise<PartnerListItem[]> {
  return db.partner.findMany({
    where: { showOnHome: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
}

/** Validate that a partner logo key belongs to the partner-logos prefix. */
export function isPartnerLogoKey(key: string): boolean {
  return key.startsWith('partner-logos/')
}
