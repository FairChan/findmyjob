import 'server-only'
import { randomBytes, createHash } from 'crypto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '../db'
import { logAudit } from './audit'
import { getSetting } from './settings'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { acceptManagedTransfer } from './managed-company'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import { assertSeatCapacity } from './subscription-entitlements'
import type { CompanyCtx, UserCtx } from '../authz'

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 }

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

async function assertTeamManager(tx: Prisma.TransactionClient, ctx: CompanyCtx, ownerOnly = false): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { role: true, status: true } })
  const company = await tx.company.findUnique({
    where: { id: ctx.companyId }, select: { isActive: true, isManaged: true },
  })
  const member = await tx.companyMember.findFirst({
    where: { companyId: ctx.companyId, userId: ctx.userId }, select: { role: true },
  })
  if (!user || user.status !== 'ACTIVE' || user.role !== 'EMPLOYER'
    || !company?.isActive || company.isManaged || !member
    || (ownerOnly ? member.role !== 'OWNER' : member.role === 'RECRUITER')) throw new ForbiddenError()
}

export async function inviteMember(
  ctx: CompanyCtx,
  input: InviteMemberInput,
): Promise<{ token: string }> {
  const { userId, companyId } = ctx
  const token = randomBytes(32).toString('base64url')
  const hash = tokenHash(token)
  await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, companyId)
    const now = new Date()
    await assertTeamManager(tx, ctx)
    await assertSeatCapacity(tx, { companyId, now, includePendingInvites: true })

    const existingMember = await tx.companyMember.findFirst({
      where: { companyId, user: { email: input.email } }, select: { id: true },
    })
    if (existingMember) throw new ValidationError('User is already a member of this company')

    // The UTC daily anti-abuse limit is independent of subscription seat capacity.
    const configuredDailyLimit = await getSetting<unknown>('team.maxInvitesPerDay', 3, { tx, fresh: true })
    const maxInvitesPerDay = typeof configuredDailyLimit === 'number'
      && Number.isSafeInteger(configuredDailyLimit) && configuredDailyLimit >= 0 ? configuredDailyLimit : 3
    const todayStart = new Date(now)
    todayStart.setUTCHours(0, 0, 0, 0)
    const pendingTodayCount = await tx.companyInvite.count({
      where: {
        companyId, createdById: userId, createdAt: { gte: todayStart },
        acceptedAt: null, expiresAt: { gt: now },
      },
    })
    if (pendingTodayCount >= maxInvitesPerDay) throw new ValidationError('Daily invite limit reached')

    await tx.companyInvite.create({
      data: {
        companyId, email: input.email, role: input.role, tokenHash: hash, createdById: userId,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), createdAt: now,
      },
    })
    await logAudit({
      actorId: userId, action: 'company.invite.send', targetType: 'Company',
      targetId: companyId, metadata: { role: input.role },
    }, tx)
  }, TRANSACTION_OPTIONS)

  return { token }
}

export async function acceptInvite(ctx: UserCtx, token: string): Promise<void> {
  const { userId } = ctx
  const hash = tokenHash(token)
  // This read only locates the company/flow. All acceptance facts are re-read under its lock.
  const located = await db.companyInvite.findUnique({
    where: { tokenHash: hash },
    select: { companyId: true, role: true, company: { select: { isManaged: true } } },
  })
  if (!located) throw new NotFoundError('Invite not found')
  if (located.company.isManaged && located.role === 'OWNER') return acceptManagedTransfer(ctx, token)

  try {
    await db.$transaction(async tx => {
      await lockXact(tx, LOCK_NS.CREDIT, located.companyId)
      const now = new Date()
      const invite = await tx.companyInvite.findUnique({
        where: { tokenHash: hash },
        include: { company: { select: { isActive: true, isManaged: true } } },
      })
      if (!invite || invite.companyId !== located.companyId) throw new NotFoundError('Invite not found')
      if (invite.acceptedAt) throw new ValidationError('Invite already used')
      if (invite.expiresAt <= now) throw new ValidationError('Invite has expired')
      if (!invite.company.isActive) throw new ValidationError('Company is no longer active')
      if (invite.role === 'OWNER') {
        throw new ForbiddenError('OWNER can only be assigned via managed company transfer')
      }
      if (invite.company.isManaged) {
        throw new ForbiddenError('Cannot accept member invite for a platform-managed company')
      }
      const user = await tx.user.findUnique({
        where: { id: userId }, select: { email: true, emailVerified: true, role: true, status: true },
      })
      if (!user || user.status !== 'ACTIVE') throw new ForbiddenError()
      if (!user.emailVerified) throw new ForbiddenError('Email must be verified to accept an invite')
      if (user.role !== 'EMPLOYER') throw new ForbiddenError('Only employer accounts can accept team invites')
      if (user.email.toLowerCase() !== invite.email.toLowerCase()) throw new ForbiddenError('Email does not match the invite')
      const anyMembership = await tx.companyMember.findFirst({ where: { userId }, select: { id: true } })
      if (anyMembership) throw new ValidationError('Already a member of a company')
      await assertSeatCapacity(tx, { companyId: invite.companyId, now })

      const consumed = await tx.companyInvite.updateMany({
        where: { id: invite.id, companyId: located.companyId, acceptedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      })
      if (consumed.count !== 1) throw new ValidationError('Invite is no longer available')
      await tx.companyMember.create({
        data: { companyId: invite.companyId, userId, role: invite.role, createdAt: now },
      })
      await logAudit({
        actorId: userId, action: 'company.invite.accept', targetType: 'Company',
        targetId: invite.companyId, metadata: { role: invite.role },
      }, tx)
    }, TRANSACTION_OPTIONS)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ValidationError('Already a member of a company')
    }
    throw err
  }
}

export async function removeMember(ctx: CompanyCtx, input: RemoveMemberInput): Promise<void> {
  const { userId, companyId } = ctx
  await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, companyId)
    const now = new Date()
    await assertTeamManager(tx, ctx)
    const target = await tx.companyMember.findUnique({
      where: { id: input.memberId }, select: { id: true, companyId: true, role: true, userId: true },
    })
    if (!target || target.companyId !== companyId) throw new NotFoundError()
    if (target.role === 'OWNER') throw new ForbiddenError('Cannot remove the OWNER')
    if (target.userId === userId) throw new ForbiddenError('Cannot remove yourself')
    await tx.companyMember.delete({ where: { id: target.id } })
    await tx.companyInvite.updateMany({
      where: { companyId, createdById: target.userId, acceptedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    })
    await logAudit({
      actorId: userId, action: 'company.member.remove', targetType: 'Company', targetId: companyId,
      metadata: { removedUserId: target.userId, removedRole: target.role },
    }, tx)
  }, TRANSACTION_OPTIONS)
}

export async function changeRole(ctx: CompanyCtx, input: ChangeRoleInput): Promise<void> {
  const { userId, companyId } = ctx
  await db.$transaction(async tx => {
    await lockXact(tx, LOCK_NS.CREDIT, companyId)
    await assertTeamManager(tx, ctx, true)
    const target = await tx.companyMember.findUnique({
      where: { id: input.memberId }, select: { id: true, companyId: true, role: true, userId: true },
    })
    if (!target || target.companyId !== companyId) throw new NotFoundError()
    if (target.role === 'OWNER') throw new ForbiddenError('Cannot change the OWNER role')
    await tx.companyMember.update({ where: { id: target.id }, data: { role: input.role } })
    await logAudit({
      actorId: userId, action: 'company.member.role_change', targetType: 'Company', targetId: companyId,
      metadata: { targetUserId: target.userId, oldRole: target.role, newRole: input.role },
    }, tx)
  }, TRANSACTION_OPTIONS)
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
