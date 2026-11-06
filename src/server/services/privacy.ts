import 'server-only'
import { z } from 'zod'
import { Visibility } from '@prisma/client'
import { db } from '../db'
import { getSetting } from './settings'
import { logAudit } from './audit'
import { NotFoundError } from '../errors'

export const setVisibilitySchema = z.object({
  granted: z.boolean(),
})

export const blockCompanySchema = z.object({
  companyId: z.string().cuid(),
})

export const unblockCompanySchema = z.object({
  companyId: z.string().cuid(),
})

export const searchCompaniesSchema = z.object({
  query: z.string().min(1).max(100),
})

// ---- Visibility ----

export async function getLatestTalentPoolConsent(
  userId: string,
): Promise<boolean | null> {
  const latest = await db.consent.findFirst({
    where: { userId, type: 'TALENT_POOL' },
    orderBy: { createdAt: 'desc' },
    select: { granted: true },
  })
  return latest?.granted ?? null
}

export async function setVisibility(
  ctx: { userId: string },
  input: z.infer<typeof setVisibilitySchema>,
  meta: { ip?: string | null } = {},
): Promise<void> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) throw new NotFoundError('Student profile not found')

  const version = await getSetting<string>('legal.currentVersion', '1.0')
  const newVisibility = input.granted ? Visibility.PUBLIC : Visibility.HIDDEN

  await db.$transaction([
    db.studentProfile.update({
      where: { id: profile.id },
      data: { visibility: newVisibility },
    }),
    db.consent.create({
      data: {
        userId: ctx.userId,
        type: 'TALENT_POOL',
        version,
        granted: input.granted,
        ip: meta.ip ?? null,
      },
    }),
  ])

  await logAudit({
    actorId: ctx.userId,
    action: 'student.visibility.change',
    targetType: 'StudentProfile',
    targetId: profile.id,
    metadata: { granted: input.granted, visibility: newVisibility },
    ip: meta.ip ?? undefined,
  })
}

// ---- Blocked companies ----

export async function listBlockedCompanies(ctx: { userId: string }): Promise<
  Array<{ companyId: string; companyName: string; createdAt: Date }>
> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) return []

  const rows = await db.blockedCompany.findMany({
    where: { studentId: profile.id },
    orderBy: { createdAt: 'desc' },
    include: {
      company: { select: { legalName: true, displayNameZh: true, displayNameEn: true } },
    },
  })

  return rows.map((r) => ({
    companyId: r.companyId,
    companyName: r.company.displayNameZh ?? r.company.displayNameEn ?? r.company.legalName,
    createdAt: r.createdAt,
  }))
}

export async function addBlockedCompany(
  ctx: { userId: string },
  input: z.infer<typeof blockCompanySchema>,
): Promise<void> {
  const [profile, company] = await Promise.all([
    db.studentProfile.findUnique({ where: { userId: ctx.userId }, select: { id: true } }),
    db.company.findUnique({
      where: { id: input.companyId },
      select: { id: true, verificationStatus: true },
    }),
  ])
  if (!profile) throw new NotFoundError('Student profile not found')
  if (!company || company.verificationStatus !== 'VERIFIED') {
    throw new NotFoundError('Company not found')
  }

  await db.blockedCompany.upsert({
    where: { studentId_companyId: { studentId: profile.id, companyId: input.companyId } },
    create: { studentId: profile.id, companyId: input.companyId },
    update: {},
  })
}

export async function removeBlockedCompany(
  ctx: { userId: string },
  input: z.infer<typeof unblockCompanySchema>,
): Promise<void> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) throw new NotFoundError('Student profile not found')

  await db.blockedCompany.deleteMany({
    where: { studentId: profile.id, companyId: input.companyId },
  })
}

export async function searchVerifiedCompanies(
  input: z.infer<typeof searchCompaniesSchema>,
): Promise<Array<{ id: string; name: string }>> {
  const q = `%${input.query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
  const rows = await db.company.findMany({
    where: {
      verificationStatus: 'VERIFIED',
      isActive: true,
      OR: [
        { legalName: { contains: input.query, mode: 'insensitive' } },
        { displayNameZh: { contains: input.query, mode: 'insensitive' } },
        { displayNameEn: { contains: input.query, mode: 'insensitive' } },
      ],
    },
    orderBy: { legalName: 'asc' },
    take: 20,
    select: { id: true, legalName: true, displayNameZh: true, displayNameEn: true },
  })
  void q // q was prepared for raw SQL but Prisma mode:insensitive is sufficient
  return rows.map((r) => ({
    id: r.id,
    name: r.displayNameZh ?? r.displayNameEn ?? r.legalName,
  }))
}

// ---- Who viewed / unlocked me ----

export async function getProfileViews(ctx: { userId: string }): Promise<
  Array<{ companyId: string; companyName: string; viewedAt: Date }>
> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) return []

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  // Distinct per company: pick the latest view per company in the last 90 days
  const rows = await db.profileView.findMany({
    where: { studentId: profile.id, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    include: {
      company: { select: { legalName: true, displayNameZh: true, displayNameEn: true } },
    },
  })

  const seen = new Set<string>()
  const result: Array<{ companyId: string; companyName: string; viewedAt: Date }> = []
  for (const r of rows) {
    if (seen.has(r.companyId)) continue
    seen.add(r.companyId)
    result.push({
      companyId: r.companyId,
      companyName:
        r.company.displayNameZh ?? r.company.displayNameEn ?? r.company.legalName,
      viewedAt: r.createdAt,
    })
  }
  return result
}

export async function getUnlocks(ctx: { userId: string }): Promise<
  Array<{ companyId: string; companyName: string; unlockedAt: Date }>
> {
  const profile = await db.studentProfile.findUnique({
    where: { userId: ctx.userId },
    select: { id: true },
  })
  if (!profile) return []

  const rows = await db.talentUnlock.findMany({
    where: { studentId: profile.id },
    orderBy: { createdAt: 'desc' },
    include: {
      company: { select: { legalName: true, displayNameZh: true, displayNameEn: true } },
    },
  })

  return rows.map((r) => ({
    companyId: r.companyId,
    companyName:
      r.company.displayNameZh ?? r.company.displayNameEn ?? r.company.legalName,
    unlockedAt: r.createdAt,
  }))
}
