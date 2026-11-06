import 'server-only'
import { randomBytes, createHash } from 'crypto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { logAudit } from './audit'
import { getSetting } from './settings'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import type { CompanyCtx, UserCtx } from '../authz'

export const inviteMemberSchema = z.object({
  email: z.string().email().max(255).toLowerCase(),
  role: z.enum(['ADMIN', 'RECRUITER']),
})
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

export const changeRoleSchema = z.object({
  memberId: z.string().cuid(),
  role: z.enum(['ADMIN', 'RECRUITER']),
})
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>

export const removeMemberSchema = z.object({
  memberId: z.string().cuid(),
})
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function inviteMember(
  ctx: CompanyCtx,
  input: InviteMemberInput,
): Promise<{ token: string }> {
  const { userId, companyId, role } = ctx

  // RECRUITER cannot manage the team
  if (role === 'RECRUITER') throw new ForbiddenError('RECRUITER cannot invite members')

  const maxMembers = await getSetting<number>('team.maxMembers', 3)
  const maxInvitesPerDay = await getSetting<number>('team.maxInvitesPerDay', 3)

  // Count current active members
  const memberCount = await db.companyMember.count({ where: { companyId } })
  if (memberCount >= maxMembers) throw new ValidationError('Team member limit reached')

  // Check if the email is already a member
  const existingMember = await db.companyMember.findFirst({
    where: {
      companyId,
      user: { email: input.email },
    },
    select: { id: true },
  })
  if (existingMember) throw new ValidationError('User is already a member of this company')

  // Check daily invite rate limit for the inviting user
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const pendingTodayCount = await db.companyInvite.count({
    where: {
      companyId,
      createdById: userId,
      createdAt: { gte: todayStart },
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
  })
  if (pendingTodayCount >= maxInvitesPerDay) {
    throw new ValidationError('Daily invite limit reached')
  }

  const token = randomBytes(32).toString('base64url')
  const hash = tokenHash(token)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await db.companyInvite.create({
    data: {
      companyId,
      email: input.email,
      role: input.role,
      tokenHash: hash,
      expiresAt,
      createdById: userId,
    },
  })

  await logAudit({
    actorId: userId,
    action: 'company.invite.send',
    targetType: 'Company',
    targetId: companyId,
    metadata: { email: input.email, role: input.role },
  })

  return { token }
}

export async function acceptInvite(ctx: UserCtx, token: string): Promise<void> {
  const { userId } = ctx

  const hash = tokenHash(token)
  const invite = await db.companyInvite.findUnique({
    where: { tokenHash: hash },
    include: { company: { select: { id: true, legalName: true, isActive: true } } },
  })

  if (!invite) throw new NotFoundError('Invite not found')
  if (invite.acceptedAt) throw new ValidationError('Invite already used')
  if (invite.expiresAt < new Date()) throw new ValidationError('Invite has expired')
  if (!invite.company.isActive) throw new ValidationError('Company is no longer active')

  // Email must match (case-insensitive)
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true, role: true },
  })
  if (!user) throw new ForbiddenError()
  if (!user.emailVerified) throw new ForbiddenError('Email must be verified to accept an invite')
  if (user.role !== 'EMPLOYER') throw new ForbiddenError('Only employer accounts can accept team invites')
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new ForbiddenError('Email does not match the invite')
  }

  // MVP: one company per user — check membership in any company
  const anyMembership = await db.companyMember.findFirst({
    where: { userId },
    select: { id: true },
  })
  if (anyMembership) throw new ValidationError('Already a member of a company')

  try {
    await db.$transaction(async tx => {
      await tx.companyInvite.update({
        where: { tokenHash: hash },
        data: { acceptedAt: new Date() },
      })
      await tx.companyMember.create({
        data: { companyId: invite.companyId, userId, role: invite.role },
      })
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ValidationError('Already a member of a company')
    }
    throw err
  }

  await logAudit({
    actorId: userId,
    action: 'company.invite.accept',
    targetType: 'Company',
    targetId: invite.companyId,
    metadata: { role: invite.role },
  })
}

export async function removeMember(ctx: CompanyCtx, input: RemoveMemberInput): Promise<void> {
  const { userId, companyId, role } = ctx

  if (role === 'RECRUITER') throw new ForbiddenError('RECRUITER cannot remove members')

  const target = await db.companyMember.findUnique({
    where: { id: input.memberId },
    select: { id: true, companyId: true, role: true, userId: true },
  })
  if (!target || target.companyId !== companyId) throw new NotFoundError()
  if (target.role === 'OWNER') throw new ForbiddenError('Cannot remove the OWNER')
  if (target.userId === userId) throw new ForbiddenError('Cannot remove yourself')

  await db.companyMember.delete({ where: { id: input.memberId } })

  await logAudit({
    actorId: userId,
    action: 'company.member.remove',
    targetType: 'Company',
    targetId: companyId,
    metadata: { removedUserId: target.userId, removedRole: target.role },
  })
}

export async function changeRole(ctx: CompanyCtx, input: ChangeRoleInput): Promise<void> {
  const { userId, companyId, role } = ctx

  // Only OWNER can change roles
  if (role !== 'OWNER') throw new ForbiddenError('Only OWNER can change member roles')

  const target = await db.companyMember.findUnique({
    where: { id: input.memberId },
    select: { id: true, companyId: true, role: true, userId: true },
  })
  if (!target || target.companyId !== companyId) throw new NotFoundError()
  if (target.role === 'OWNER') throw new ForbiddenError('Cannot change the OWNER role')

  await db.companyMember.update({
    where: { id: input.memberId },
    data: { role: input.role },
  })

  await logAudit({
    actorId: userId,
    action: 'company.member.role_change',
    targetType: 'Company',
    targetId: companyId,
    metadata: { targetUserId: target.userId, oldRole: target.role, newRole: input.role },
  })
}

export interface TeamMember {
  id: string
  userId: string
  name: string
  email: string
  role: 'OWNER' | 'ADMIN' | 'RECRUITER'
  joinedAt: Date
}

export async function listTeamMembers(ctx: CompanyCtx): Promise<TeamMember[]> {
  const members = await db.companyMember.findMany({
    where: { companyId: ctx.companyId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return members.map(m => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    joinedAt: m.createdAt,
  }))
}

export interface InviteDetails {
  companyName: string
  role: 'ADMIN' | 'RECRUITER'
  email: string
}

export async function getInviteDetails(token: string): Promise<InviteDetails | null> {
  const hash = tokenHash(token)
  const invite = await db.companyInvite.findUnique({
    where: { tokenHash: hash },
    include: { company: { select: { legalName: true, isActive: true } } },
  })
  if (!invite) return null
  if (invite.acceptedAt) return null
  if (invite.expiresAt < new Date()) return null
  if (!invite.company.isActive) return null

  return {
    companyName: invite.company.legalName,
    role: invite.role as 'ADMIN' | 'RECRUITER',
    email: invite.email,
  }
}
