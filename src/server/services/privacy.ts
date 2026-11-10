import 'server-only'
import { z } from 'zod'
import { Visibility, Prisma, type UnlockSource } from '@prisma/client'
import { db } from '../db'
import { getSetting } from './settings'
import { logAudit } from './audit'
import { NotFoundError, ForbiddenError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { invalidateStudentMatchingIndexTx } from './semantic-matching'

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
  const newVisibility = input.granted ? Visibility.PUBLIC : Visibility.HIDDEN
  await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.STUDENT_DATA, ctx.userId)
    const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { role: true, status: true } })
    if (user?.role !== 'STUDENT' || user.status !== 'ACTIVE') throw new ForbiddenError()
    const profile = await tx.studentProfile.findUnique({ where: { userId: ctx.userId }, select: { id: true, visibility: true } })
    if (!profile) throw new NotFoundError('Student profile not found')
    const version = await getSetting<string>('legal.currentVersion', '1.0', { tx, fresh: true })
    if (profile.visibility !== newVisibility) {
      await tx.studentProfile.update({ where: { id: profile.id }, data: { visibility: newVisibility, editRevision: { increment: 1 } } })
      await invalidateStudentMatchingIndexTx(tx, ctx.userId)
    }
    await tx.consent.create({
      data: {
        userId: ctx.userId,
        type: 'TALENT_POOL',
        version,
        granted: input.granted,
        ip: meta.ip ?? null,
      },
    })
    await logAudit({
      actorId: ctx.userId,
      action: 'student.visibility.change',
      targetType: 'StudentProfile',
      targetId: profile.id,
      metadata: { granted: input.granted, visibility: newVisibility },
      ip: meta.ip ?? undefined,
    }, tx)
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

  await db.$transaction(async (tx) => {
    await tx.blockedCompany.upsert({
      where: { studentId_companyId: { studentId: profile.id, companyId: input.companyId } },
      create: { studentId: profile.id, companyId: input.companyId },
      update: {},
    })
    await logAudit({
      actorId: ctx.userId,
      action: 'student.block_company',
      targetType: 'Company',
      targetId: input.companyId,
      metadata: { studentId: profile.id },
    }, tx)
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

  await db.$transaction(async (tx) => {
    await tx.blockedCompany.deleteMany({
      where: { studentId: profile.id, companyId: input.companyId },
    })
    await logAudit({
      actorId: ctx.userId,
      action: 'student.unblock_company',
      targetType: 'Company',
      targetId: input.companyId,
      metadata: { studentId: profile.id },
    }, tx)
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

  // DISTINCT ON (companyId, KL-date): one row per (company, Kuala Lumpur calendar day),
  // keeping the most recent view in each bucket, then sorted newest-first.
  const rows = await db.$queryRaw<
    Array<{
      companyId: string
      createdAt: Date
      legalName: string
      displayNameZh: string | null
      displayNameEn: string | null
    }>
  >(Prisma.sql`
    SELECT *
    FROM (
      SELECT DISTINCT ON (pv."companyId", (pv."createdAt" AT TIME ZONE 'Asia/Kuala_Lumpur')::date)
        pv."companyId",
        pv."createdAt",
        c."legalName",
        c."displayNameZh",
        c."displayNameEn"
      FROM "ProfileView" pv
      JOIN "Company" c ON c."id" = pv."companyId"
      WHERE pv."studentId" = ${profile.id}
        AND pv."createdAt" >= ${since}
      ORDER BY pv."companyId", (pv."createdAt" AT TIME ZONE 'Asia/Kuala_Lumpur')::date, pv."createdAt" DESC
    ) sub
    ORDER BY "createdAt" DESC
    LIMIT 200
  `)

  return rows.map((r) => ({
    companyId: r.companyId,
    companyName: r.displayNameZh ?? r.displayNameEn ?? r.legalName,
    viewedAt: r.createdAt,
  }))
}

export async function getUnlocks(ctx: { userId: string }): Promise<
  Array<{ companyId: string; companyName: string; unlockedAt: Date; source: UnlockSource }>
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
    source: r.source,
  }))
}
