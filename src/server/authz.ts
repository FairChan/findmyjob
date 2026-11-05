import 'server-only'
import { db } from './db'
import { ForbiddenError } from './errors'
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
    select: { id: true, role: true, status: true },
  })

  if (!user || user.status !== 'ACTIVE') throw new ForbiddenError()
  return user
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

export async function requireAdmin(headers: Headers): Promise<UserCtx> {
  const user = await loadActiveUser(headers)
  if (user.role !== 'ADMIN') throw new ForbiddenError()
  return { userId: user.id }
}
