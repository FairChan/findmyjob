import 'server-only'
import { z } from 'zod'
import { db } from '../db'
import { ForbiddenError, NotFoundError } from '../errors'
import { logAudit } from './audit'
import { getContactForAdmin } from './contact-access'
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

export const searchStudentsSchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
  page: z.number().int().min(1).default(1),
})

export type SearchStudentsInput = z.infer<typeof searchStudentsSchema>

export interface StudentListItem {
  userId: string
  profileId: string
  fullName: string
  email: string
  status: string
  schoolVerifiedAt: Date | null
  completeness: number
  createdAt: Date
}

export async function searchStudents(
  ctx: UserCtx,
  input: SearchStudentsInput,
): Promise<{ items: StudentListItem[]; total: number }> {
  await assertAdmin(ctx.userId)

  const { q, status, page } = searchStudentsSchema.parse(input)
  const pageSize = 20
  const skip = (page - 1) * pageSize

  const escaped = q
    ? q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    : undefined

  const where = {
    role: 'STUDENT' as const,
    ...(status ? { status } : {}),
    ...(escaped
      ? {
          OR: [
            { name: { contains: escaped, mode: 'insensitive' as const } },
            { email: { contains: escaped, mode: 'insensitive' as const } },
            { studentProfile: { fullName: { contains: escaped, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      include: {
        studentProfile: {
          select: {
            id: true,
            fullName: true,
            schoolVerifiedAt: true,
            completeness: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    db.user.count({ where }),
  ])

  const items: StudentListItem[] = users.map((u) => ({
    userId: u.id,
    profileId: u.studentProfile?.id ?? '',
    fullName: u.studentProfile?.fullName ?? u.name,
    email: u.email,
    status: u.status,
    schoolVerifiedAt: u.studentProfile?.schoolVerifiedAt ?? null,
    completeness: u.studentProfile?.completeness ?? 0,
    createdAt: u.createdAt,
  }))

  return { items, total }
}

// ---- Detail ----------------------------------------------------------------

export interface StudentAdminDetail {
  userId: string
  profileId: string
  name: string
  email: string
  status: string
  emailVerified: boolean
  createdAt: Date
  lastLoginAt: Date | null
  fullName: string
  headline: string | null
  visibility: string
  completeness: number
  schoolVerifiedAt: Date | null
  schoolId: string | null
  schoolEmail: string | null
  degreeLevel: string | null
  major: string | null
  graduationYear: number | null
  nationality: string | null
  workAuth: string | null
  intents: string[]
  skills: string[]
}

export async function getStudentAdminDetail(
  ctx: UserCtx,
  studentUserId: string,
): Promise<StudentAdminDetail> {
  await assertAdmin(ctx.userId)

  const user = await db.user.findUnique({
    where: { id: studentUserId },
    include: {
      studentProfile: true,
    },
  })
  if (!user || user.role !== 'STUDENT') throw new NotFoundError('Student not found')

  const p = user.studentProfile

  return {
    userId: user.id,
    profileId: p?.id ?? '',
    name: user.name,
    email: user.email,
    status: user.status,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    fullName: p?.fullName ?? user.name,
    headline: p?.headline ?? null,
    visibility: p?.visibility ?? 'HIDDEN',
    completeness: p?.completeness ?? 0,
    schoolVerifiedAt: p?.schoolVerifiedAt ?? null,
    schoolId: p?.schoolId ?? null,
    schoolEmail: p?.schoolEmail ?? null,
    degreeLevel: p?.degreeLevel ?? null,
    major: p?.major ?? null,
    graduationYear: p?.graduationYear ?? null,
    nationality: p?.nationality ?? null,
    workAuth: p?.workAuth ?? null,
    intents: p?.intents ?? [],
    skills: p?.skills ?? [],
  }
}

// ---- Contact (admin read) --------------------------------------------------

export interface AdminContactData {
  phone: string | null
  email: string | null
  whatsapp: string | null
  wechat: string | null
  linkedinUrl: string | null
}

export async function readStudentContactAdmin(
  ctx: UserCtx,
  studentUserId: string,
  ip?: string,
): Promise<AdminContactData> {
  await assertAdmin(ctx.userId)

  const profile = await db.studentProfile.findFirst({
    where: { userId: studentUserId },
    select: { id: true },
  })
  if (!profile) throw new NotFoundError('Student not found')

  return getContactForAdmin(profile.id, ctx, ip)
}

// ---- Manual school verification -------------------------------------------

export async function approveSchoolVerificationManually(
  ctx: UserCtx,
  studentUserId: string,
): Promise<void> {
  await assertAdmin(ctx.userId)

  const profile = await db.studentProfile.findFirst({
    where: { userId: studentUserId },
    select: { id: true, schoolVerifiedAt: true },
  })
  if (!profile) throw new NotFoundError('Student not found')

  await db.studentProfile.update({
    where: { id: profile.id },
    data: { schoolVerifiedAt: new Date() },
  })

  await logAudit({
    actorId: ctx.userId,
    action: 'student.school_verify',
    targetType: 'StudentProfile',
    targetId: profile.id,
    metadata: { method: 'admin_manual' },
  })
}

// ---- Grant job view quota --------------------------------------------------

export const grantJobViewQuotaSchema = z.object({
  studentUserId: z.string().min(1),
  amount: z.number().int().min(1).max(1000),
  note: z.string().min(1).max(500),
})

export type GrantJobViewQuotaInput = z.infer<typeof grantJobViewQuotaSchema>

export async function grantJobViewQuota(
  ctx: UserCtx,
  input: GrantJobViewQuotaInput,
): Promise<void> {
  await assertAdmin(ctx.userId)
  const { studentUserId, amount, note } = grantJobViewQuotaSchema.parse(input)

  const profile = await db.studentProfile.findFirst({
    where: { userId: studentUserId },
    select: { id: true },
  })
  if (!profile) throw new NotFoundError('Student not found')

  await db.jobViewGrant.create({
    data: {
      studentId: profile.id,
      source: 'ADMIN_GRANT',
      amount,
      note,
      createdById: ctx.userId,
    },
  })

  await logAudit({
    actorId: ctx.userId,
    action: 'student.view_grant',
    targetType: 'StudentProfile',
    targetId: profile.id,
    metadata: { amount, note },
  })
}

// ---- Suspend / restore -----------------------------------------------------

export const suspendUserSchema = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

export type SuspendUserInput = z.infer<typeof suspendUserSchema>

export async function suspendUser(ctx: UserCtx, input: SuspendUserInput): Promise<void> {
  await assertAdmin(ctx.userId)
  const { targetUserId, reason } = suspendUserSchema.parse(input)

  const user = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, status: true },
  })
  if (!user || user.role !== 'STUDENT') throw new NotFoundError('Student not found')
  if (user.status === 'SUSPENDED') return

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: { status: 'SUSPENDED' },
    })
    await tx.session.deleteMany({ where: { userId: targetUserId } })
    await logAudit(
      { actorId: ctx.userId, action: 'user.suspend', targetType: 'User', targetId: targetUserId, metadata: { reason } },
      tx,
    )
    await logAudit(
      { actorId: ctx.userId, action: 'auth.session.revoke', targetType: 'User', targetId: targetUserId, metadata: { reason: 'user_suspended' } },
      tx,
    )
  })
}

export const restoreUserSchema = z.object({
  targetUserId: z.string().min(1),
})

export type RestoreUserInput = z.infer<typeof restoreUserSchema>

export async function restoreUser(ctx: UserCtx, input: RestoreUserInput): Promise<void> {
  await assertAdmin(ctx.userId)
  const { targetUserId } = restoreUserSchema.parse(input)

  const user = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, status: true },
  })
  if (!user || user.role !== 'STUDENT') throw new NotFoundError('Student not found')
  if (user.status !== 'SUSPENDED') return

  await db.user.update({
    where: { id: targetUserId },
    data: { status: 'ACTIVE' },
  })

  await logAudit({
    actorId: ctx.userId,
    action: 'user.restore',
    targetType: 'User',
    targetId: targetUserId,
  })
}
