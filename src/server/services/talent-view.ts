import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { getSetting } from './settings'
import { logAudit } from './audit'
import { isStudentVisibleToCompany } from './talent-visibility'
import { NotFoundError, RateLimitedError, ForbiddenError } from '../errors'
import { toTalentDetail } from '../serializers/talent-card'
import type { TalentDetail } from '../serializers/talent-card'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'

function todayUTCStart(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

export async function viewTalentProfile(
  ctx: { userId: string; companyId: string },
  studentId: string,
): Promise<TalentDetail> {
  const visible = await isStudentVisibleToCompany(studentId, ctx.companyId)
  if (!visible) throw new NotFoundError('Student profile not found')

  // §5.1: talent operations require verified company
  const company = await db.company.findUnique({
    where: { id: ctx.companyId },
    select: { isActive: true, verificationStatus: true },
  })
  if (!company || !company.isActive || company.verificationStatus !== 'VERIFIED') {
    throw new ForbiddenError()
  }

  const [memberLimit, companyLimit] = await Promise.all([
    getSetting<number>('limits.profileViewsPerDay', 200),
    getSetting<number>('limits.companyProfileViewsPerDay', 400),
  ])

  type ProfileWithDetail = Prisma.StudentProfileGetPayload<{
    include: {
      school: { select: { id: true; nameZh: true; nameEn: true } }
      unlocks: { select: { companyId: true } }
      educations: { select: { id: true; schoolName: true; major: true; degreeLevel: true; startDate: true; endDate: true; description: true; sortOrder: true } }
      experiences: { select: { id: true; kind: true; title: true; organization: true; startDate: true; endDate: true; description: true; sortOrder: true } }
      resumes: { select: { id: true; storageKey: true; isPrimary: true; parsedJson: true } }
    }
  }>

  type TxResult =
    | { kind: 'limitHit'; limitKind: string }
    | { kind: 'ok'; profile: ProfileWithDetail | null }

  const txResult: TxResult = await db.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.PROFILE_VIEW, ctx.companyId)

    const startOfToday = todayUTCStart()

    const [alreadyByViewer, alreadyByCompany] = await Promise.all([
      tx.profileView.findFirst({
        where: { viewerId: ctx.userId, studentId, createdAt: { gte: startOfToday } },
        select: { id: true },
      }),
      tx.profileView.findFirst({
        where: { companyId: ctx.companyId, studentId, createdAt: { gte: startOfToday } },
        select: { id: true },
      }),
    ])

    if (!alreadyByViewer) {
      const rows = await tx.$queryRaw<[{ count: bigint }]>(
        Prisma.sql`SELECT COUNT(DISTINCT "studentId") AS count FROM "ProfileView" WHERE "viewerId" = ${ctx.userId} AND "createdAt" >= ${startOfToday}`,
      )
      if (Number(rows[0].count) >= memberLimit) {
        return { kind: 'limitHit', limitKind: 'memberDailyViews' }
      }
    }

    if (!alreadyByCompany) {
      const rows = await tx.$queryRaw<[{ count: bigint }]>(
        Prisma.sql`SELECT COUNT(DISTINCT "studentId") AS count FROM "ProfileView" WHERE "companyId" = ${ctx.companyId} AND "createdAt" >= ${startOfToday}`,
      )
      if (Number(rows[0].count) >= companyLimit) {
        return { kind: 'limitHit', limitKind: 'companyDailyViews' }
      }
    }

    const profile = await tx.studentProfile.findUnique({
      where: { id: studentId },
      include: {
        school: { select: { id: true, nameZh: true, nameEn: true } },
        unlocks: {
          where: { companyId: ctx.companyId },
          take: 1,
          select: { companyId: true },
        },
        educations: {
          select: {
            id: true,
            schoolName: true,
            major: true,
            degreeLevel: true,
            startDate: true,
            endDate: true,
            description: true,
            sortOrder: true,
          },
        },
        experiences: {
          select: {
            id: true,
            kind: true,
            title: true,
            organization: true,
            startDate: true,
            endDate: true,
            description: true,
            sortOrder: true,
          },
        },
        resumes: {
          select: {
            id: true,
            storageKey: true,
            isPrimary: true,
            parsedJson: true,
          },
        },
      },
    })

    await tx.profileView.create({
      data: { companyId: ctx.companyId, studentId, viewerId: ctx.userId },
    })

    return { kind: 'ok', profile }
  })

  if (txResult.kind === 'limitHit') {
    await logAudit({
      actorId: ctx.userId,
      action: 'talent.limit.hit',
      targetType: 'ProfileView',
      metadata: { kind: txResult.limitKind, companyId: ctx.companyId },
    })
    throw new RateLimitedError('Daily profile view limit reached')
  }

  const { profile } = txResult

  await logAudit({
    actorId: ctx.userId,
    action: 'talent.view',
    targetType: 'StudentProfile',
    targetId: studentId,
    metadata: { companyId: ctx.companyId },
  })

  if (!profile) throw new NotFoundError('Student profile not found')

  return toTalentDetail(
    {
      id: profile.id,
      fullName: profile.fullName,
      headline: profile.headline,
      summary: profile.summary,
      skills: profile.skills,
      major: profile.major,
      degreeLevel: profile.degreeLevel,
      graduationYear: profile.graduationYear,
      cgpa: profile.cgpa,
      workAuth: profile.workAuth,
      completeness: profile.completeness,
      visibility: profile.visibility,
      school: profile.school,
      lastActiveAt: profile.lastActiveAt,
      educations: profile.educations,
      experiences: profile.experiences,
      resumes: profile.resumes,
    },
    { unlocked: profile.unlocks.length > 0, contact: null },
  )
}
