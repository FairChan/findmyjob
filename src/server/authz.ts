import 'server-only'
import { db } from './db'
import { ForbiddenError, TwoFactorRequiredError, FreshSessionRequiredError } from './errors'
import { getSession } from './auth'
import type { CompanyMemberRole } from '@prisma/client'

export type UserCtx = { userId: string }
export type CompanyCtx = { userId: string; companyId: string; role: CompanyMemberRole }

const ROLE_ORDER: CompanyMemberRole[] = ['RECRUITER', 'ADMIN', 'OWNER']

function hasMinRole(actual: CompanyMemberRole, min: CompanyMemberRole): boolean {
  return ROLE_ORDER.indexOf(actual) >= ROLE_ORDER.indexOf(min)
}

async function loadActiveUser(headers: Headers) {
  const session = await getSession(headers)
  if (!session?.user?.id) throw new ForbiddenError()

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, status: true, twoFactorEnabled: true },
  })

  if (!user || user.status !== 'ACTIVE') throw new ForbiddenError()
  // An admin's absolute lifetime must not grow when Better Auth refreshes updatedAt.
  if (user.role === 'ADMIN') {
    const age = Date.now() - new Date(session.session.createdAt).getTime()
    if (!Number.isFinite(age) || age < 0 || age >= 12 * 3600_000) throw new ForbiddenError()
  }
  return { ...user, session: session.session }
}

export async function requireUser(headers: Headers): Promise<UserCtx> {
  const user = await loadActiveUser(headers)
  return { userId: user.id }
}

export async function requireStudent(headers: Headers): Promise<UserCtx> {
  const user = await loadActiveUser(headers)
  if (user.role !== 'STUDENT') throw new ForbiddenError()
  return { userId: user.id }
}

export async function requireEmployer(headers: Headers): Promise<UserCtx> {
  const user = await loadActiveUser(headers)
  if (user.role !== 'EMPLOYER') throw new ForbiddenError()
  return { userId: user.id }
}

export async function requireCompanyMember(
  minRole: CompanyMemberRole,
  headers: Headers,
): Promise<CompanyCtx> {
  const user = await loadActiveUser(headers)
  if (user.role !== 'EMPLOYER') throw new ForbiddenError()

  const member = await db.companyMember.findFirst({
    where: { userId: user.id },
    include: {
      company: { select: { id: true, isActive: true } },
    },
  })

  if (!member || !member.company.isActive) throw new ForbiddenError()
  if (!hasMinRole(member.role, minRole)) throw new ForbiddenError()

  return { userId: user.id, companyId: member.companyId, role: member.role }
}

export async function requireVerifiedCompany(
  minRole: CompanyMemberRole = 'RECRUITER',
  headers: Headers,
): Promise<CompanyCtx> {
  const user = await loadActiveUser(headers)
  if (user.role !== 'EMPLOYER') throw new ForbiddenError()

  const member = await db.companyMember.findFirst({
    where: { userId: user.id },
    include: {
      company: { select: { id: true, isActive: true, verificationStatus: true } },
    },
  })

  if (!member || !member.company.isActive) throw new ForbiddenError()
  if (member.company.verificationStatus !== 'VERIFIED') throw new ForbiddenError()
  if (!hasMinRole(member.role, minRole)) throw new ForbiddenError()

  return { userId: user.id, companyId: member.companyId, role: member.role }
}

export async function requireAdmin(headers: Headers, options: { fresh?: boolean } = {}): Promise<UserCtx> {
  const user = await loadActiveUser(headers)
  if (user.role !== 'ADMIN') throw new ForbiddenError()
  if (!user.twoFactorEnabled) throw new TwoFactorRequiredError()
  const verifiedAt = user.session.twoFactorVerifiedAt
  const age = verifiedAt ? Date.now() - new Date(verifiedAt).getTime() : NaN
  if (!Number.isFinite(age) || age < 0) throw new ForbiddenError()
  if (options.fresh && age >= 600_000) throw new FreshSessionRequiredError()
  return { userId: user.id }
}

/** Service-layer check: throws ForbiddenError if the company is not active + verified. */
export async function assertCompanyVerified(companyId: string): Promise<void> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { isActive: true, verificationStatus: true },
  })
  if (!company || !company.isActive || company.verificationStatus !== 'VERIFIED') {
    throw new ForbiddenError()
  }
}
