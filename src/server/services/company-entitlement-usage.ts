import 'server-only'
import type { CompanyCtx } from '../authz'
import { db } from '../db'
import { ForbiddenError } from '../errors'
import { resolveCompanyEntitlements } from './subscription-entitlements'
import { getSetting } from './settings'
import { klMonthBounds } from '../lib/kl-month'

export interface CompanyEntitlementUsage {
  source: 'SUBSCRIPTION' | 'FREE' | 'PILOT'
  effectiveUntil: string | null
  jobs: { used: number; limit: number | null }
  seats: { used: number; reserved: number; limit: number | null }
  invitations: { used: number; limit: number | null }
  canPurchase: boolean
}

/** Display-only snapshot; growth actions recheck their current allowance under CREDIT. */
export async function getCompanyEntitlementUsage(ctx: CompanyCtx): Promise<CompanyEntitlementUsage> {
  return db.$transaction(async tx => {
    const member = await tx.companyMember.findUnique({
      where: { companyId_userId: { companyId: ctx.companyId, userId: ctx.userId } },
      select: { role: true, user: { select: { status: true, role: true } }, company: { select: { isActive: true } } },
    })
    if (!member || member.user.status !== 'ACTIVE' || member.user.role !== 'EMPLOYER'
      || !member.company.isActive) throw new ForbiddenError()
    const now = new Date()
    const entitlement = await resolveCompanyEntitlements(tx, { companyId: ctx.companyId, now })
    const { start, end } = klMonthBounds(now)
    const [jobs, members, reserved, invitations, enabled] = await Promise.all([
      tx.job.count({ where: { companyId: ctx.companyId, status: 'PUBLISHED', OR: [{ deadline: null }, { deadline: { gt: now } }] } }),
      tx.companyMember.count({ where: { companyId: ctx.companyId } }),
      tx.companyInvite.count({ where: { companyId: ctx.companyId, role: { in: ['ADMIN', 'RECRUITER'] }, acceptedAt: null, expiresAt: { gt: now } } }),
      tx.invitation.count({ where: { companyId: ctx.companyId, createdAt: { gte: start, lt: end } } }),
      getSetting<unknown>('billing.enabled', false, { tx, fresh: true }),
    ])
    return {
      source: entitlement.source, effectiveUntil: entitlement.effectiveUntil?.toISOString() ?? null,
      jobs: { used: jobs, limit: entitlement.jobPostLimit },
      seats: { used: members, reserved, limit: entitlement.seatLimit },
      invitations: { used: invitations, limit: entitlement.invitationQuota },
      canPurchase: member.role === 'OWNER' && enabled === true,
    }
  })
}
