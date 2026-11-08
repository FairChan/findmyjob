/**
 * Integration tests for admin-companies service.
 * Uses the real test database (findmyjob_test via TEST_DATABASE_URL).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('server-only', () => ({}))

import { setupTestDb, testDb } from '../setup/db'
import {
  searchCompanies,
  getCompanyAdminDetail,
  deactivateCompany,
  reactivateCompany,
  setFoundingPartner,
  setCompanyTags,
  adjustCompanyCredits,
} from '@/server/services/admin-companies'
import { ForbiddenError, NotFoundError } from '@/server/errors'

setupTestDb()

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function mkAdmin() {
  return testDb.user.create({
    data: {
      name: 'Admin',
      email: `admin-${uid()}@example.test`,
      emailVerified: true,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  })
}

async function mkStudent() {
  return testDb.user.create({
    data: {
      name: 'Student',
      email: `student-${uid()}@example.test`,
      emailVerified: true,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  })
}

async function mkCompany(overrides?: { isActive?: boolean; legalName?: string }) {
  return testDb.company.create({
    data: {
      legalName: overrides?.legalName ?? `Company-${uid()}`,
      isActive: overrides?.isActive ?? true,
    },
  })
}

async function mkEmployer(companyId: string) {
  const user = await testDb.user.create({
    data: {
      name: 'Employer',
      email: `employer-${uid()}@example.test`,
      emailVerified: true,
      role: 'EMPLOYER',
      status: 'ACTIVE',
    },
  })
  await testDb.companyMember.create({
    data: { companyId, userId: user.id, role: 'OWNER' },
  })
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---- searchCompanies --------------------------------------------------------

describe('searchCompanies', () => {
  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    await expect(searchCompanies({ userId: student.id }, { page: 1 })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin can list companies', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany({ legalName: `SearchTest-${uid()}` })
    const result = await searchCompanies({ userId: admin.id }, { page: 1 })
    expect(result.total).toBeGreaterThanOrEqual(1)
    expect(result.items.some((c) => c.id === company.id)).toBe(true)
  })

  it('filter by isActive=false returns only inactive', async () => {
    const admin = await mkAdmin()
    await mkCompany({ isActive: false })
    const result = await searchCompanies({ userId: admin.id }, { isActive: false, page: 1 })
    expect(result.items.every((c) => c.isActive === false)).toBe(true)
    expect(result.total).toBeGreaterThanOrEqual(1)
  })

  it('filter by verificationStatus=PENDING returns only PENDING companies', async () => {
    const admin = await mkAdmin()
    const suffix = uid()
    const pendingCo = await testDb.company.create({
      data: { legalName: `Pending-${suffix}`, verificationStatus: 'PENDING', isActive: true },
    })
    const verifiedCo = await testDb.company.create({
      data: { legalName: `Verified-${suffix}`, verificationStatus: 'VERIFIED', isActive: true },
    })
    const result = await searchCompanies({ userId: admin.id }, { verificationStatus: 'PENDING', page: 1 })
    expect(result.items.every((c) => c.verificationStatus === 'PENDING')).toBe(true)
    expect(result.items.some((c) => c.id === pendingCo.id)).toBe(true)
    expect(result.items.some((c) => c.id === verifiedCo.id)).toBe(false)
  })
})

// ---- getCompanyAdminDetail --------------------------------------------------

describe('getCompanyAdminDetail', () => {
  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    const company = await mkCompany()
    await expect(getCompanyAdminDetail({ userId: student.id }, company.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('returns company detail for admin', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    const detail = await getCompanyAdminDetail({ userId: admin.id }, company.id)
    expect(detail.id).toBe(company.id)
    expect(detail.isActive).toBe(true)
  })

  it('throws NotFound for missing company', async () => {
    const admin = await mkAdmin()
    await expect(getCompanyAdminDetail({ userId: admin.id }, 'nonexistent-id')).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ---- deactivateCompany -------------------------------------------------------

describe('deactivateCompany', () => {
  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    const company = await mkCompany()
    await expect(deactivateCompany({ userId: student.id }, { companyId: company.id, reason: 'test' })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin can deactivate an active company', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await deactivateCompany({ userId: admin.id }, { companyId: company.id, reason: 'violation' })
    const updated = await testDb.company.findUnique({ where: { id: company.id }, select: { isActive: true } })
    expect(updated?.isActive).toBe(false)
  })

  it('deactivating writes an audit log entry', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await deactivateCompany({ userId: admin.id }, { companyId: company.id, reason: 'audit-test' })
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.deactivate', targetId: company.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(audit?.actorId).toBe(admin.id)
  })

  it('deactivating revokes member sessions and writes auth.session.revoke audit', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    const employer = await mkEmployer(company.id)
    // Create a fake session
    await testDb.session.create({
      data: {
        userId: employer.id,
        token: `token-${uid()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        ipAddress: '127.0.0.1',
        userAgent: 'test',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    await deactivateCompany({ userId: admin.id }, { companyId: company.id, reason: 'revoke-test' })
    const sessions = await testDb.session.findMany({ where: { userId: employer.id } })
    expect(sessions).toHaveLength(0)
    const revokeAudit = await testDb.auditLog.findFirst({
      where: { action: 'auth.session.revoke', targetId: company.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(revokeAudit).not.toBeNull()
    expect(revokeAudit?.actorId).toBe(admin.id)
    const meta = revokeAudit?.metadata as { userIds?: string[] }
    expect(meta?.userIds).toContain(employer.id)
  })

  it('deactivating already-inactive company is idempotent', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany({ isActive: false })
    await expect(deactivateCompany({ userId: admin.id }, { companyId: company.id, reason: 'idempotent' })).resolves.toBeUndefined()
  })

  it('reason of only whitespace fails schema validation', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await expect(
      deactivateCompany({ userId: admin.id }, { companyId: company.id, reason: '   ' }),
    ).rejects.toThrow()
  })
})

// ---- reactivateCompany -------------------------------------------------------

describe('reactivateCompany', () => {
  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    const company = await mkCompany({ isActive: false })
    await expect(reactivateCompany({ userId: student.id }, { companyId: company.id })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin can reactivate an inactive company', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany({ isActive: false })
    await reactivateCompany({ userId: admin.id }, { companyId: company.id })
    const updated = await testDb.company.findUnique({ where: { id: company.id }, select: { isActive: true } })
    expect(updated?.isActive).toBe(true)
  })

  it('reactivating writes an audit log entry', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany({ isActive: false })
    await reactivateCompany({ userId: admin.id }, { companyId: company.id })
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.reactivate', targetId: company.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })
})

// ---- setFoundingPartner ------------------------------------------------------

describe('setFoundingPartner', () => {
  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    const company = await mkCompany()
    await expect(setFoundingPartner({ userId: student.id }, { companyId: company.id, isFoundingPartner: true })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin can mark founding partner', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await setFoundingPartner({ userId: admin.id }, { companyId: company.id, isFoundingPartner: true })
    const updated = await testDb.company.findUnique({ where: { id: company.id }, select: { isFoundingPartner: true } })
    expect(updated?.isFoundingPartner).toBe(true)
  })

  it('writes audit log for founding partner change', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await setFoundingPartner({ userId: admin.id }, { companyId: company.id, isFoundingPartner: true })
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.founding_partner', targetId: company.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(audit?.metadata).toMatchObject({ isFoundingPartner: true })
  })
})

// ---- setCompanyTags ----------------------------------------------------------

describe('setCompanyTags', () => {
  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    const company = await mkCompany()
    await expect(setCompanyTags({ userId: student.id }, { companyId: company.id, tags: ['MULTINATIONAL'] })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin can set tags', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await setCompanyTags({ userId: admin.id }, { companyId: company.id, tags: ['FORTUNE_500', 'MULTINATIONAL'] })
    const updated = await testDb.company.findUnique({ where: { id: company.id }, select: { tags: true } })
    expect(updated?.tags).toContain('FORTUNE_500')
    expect(updated?.tags).toContain('MULTINATIONAL')
  })

  it('writes audit log for tag change', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await setCompanyTags({ userId: admin.id }, { companyId: company.id, tags: ['SOE'] })
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.tags_update', targetId: company.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })
})

// ---- adjustCompanyCredits ----------------------------------------------------

describe('adjustCompanyCredits', () => {
  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    const company = await mkCompany()
    await expect(adjustCompanyCredits({ userId: student.id }, { companyId: company.id, delta: 100, note: 'test' })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin can adjust credits and audit is written in same transaction', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await testDb.creditWallet.create({ data: { companyId: company.id, balance: 50 } })
    const result = await adjustCompanyCredits({ userId: admin.id }, { companyId: company.id, delta: 100, note: 'top-up' })
    expect(result.balanceAfter).toBe(150)

    const audit = await testDb.auditLog.findFirst({
      where: { action: 'credits.adjust', targetId: company.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(audit?.actorId).toBe(admin.id)
  })

  it('delta=0 fails schema validation', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await testDb.creditWallet.create({ data: { companyId: company.id, balance: 50 } })
    await expect(
      adjustCompanyCredits({ userId: admin.id }, { companyId: company.id, delta: 0, note: 'zero' }),
    ).rejects.toThrow()
  })

  it('note of only whitespace fails schema validation', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await testDb.creditWallet.create({ data: { companyId: company.id, balance: 50 } })
    await expect(
      adjustCompanyCredits({ userId: admin.id }, { companyId: company.id, delta: 10, note: '   ' }),
    ).rejects.toThrow()
  })

  it('negative delta exceeding balance → InsufficientCreditsError, balance unchanged', async () => {
    const { InsufficientCreditsError } = await import('@/server/errors')
    const admin = await mkAdmin()
    const company = await mkCompany()
    await testDb.creditWallet.create({ data: { companyId: company.id, balance: 50 } })
    await expect(
      adjustCompanyCredits({ userId: admin.id }, { companyId: company.id, delta: -100, note: 'overdraft' }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError)
    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: company.id }, select: { balance: true } })
    expect(wallet?.balance).toBe(50)
  })

  it('company without wallet → NotFoundError', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await expect(
      adjustCompanyCredits({ userId: admin.id }, { companyId: company.id, delta: 10, note: 'no wallet' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('concurrent adjustments both succeed without corrupting balance', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    await testDb.creditWallet.create({ data: { companyId: company.id, balance: 100 } })
    const [r1, r2] = await Promise.all([
      adjustCompanyCredits({ userId: admin.id }, { companyId: company.id, delta: 10, note: 'a' }),
      adjustCompanyCredits({ userId: admin.id }, { companyId: company.id, delta: 20, note: 'b' }),
    ])
    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: company.id }, select: { balance: true } })
    expect(wallet?.balance).toBe(130)
    // Serialized by lockXact: one sees 110 or 120 as intermediate, the other always sees 130
    const balances = [r1.balanceAfter, r2.balanceAfter].sort((a, b) => a - b)
    expect(balances[1]).toBe(130)
    expect([110, 120]).toContain(balances[0])
  })
})

// ---- deactivate + requireCompanyMember integration ---------------------------

describe('deactivate then requireCompanyMember', () => {
  it('after deactivation, requireCompanyMember throws ForbiddenError', async () => {
    const admin = await mkAdmin()
    const company = await mkCompany()
    const employer = await mkEmployer(company.id)

    // Deactivate
    await deactivateCompany({ userId: admin.id }, { companyId: company.id, reason: 'test' })

    // requireCompanyMember should now throw
    const { requireCompanyMember } = await import('@/server/authz')
    const { getSession } = await import('@/server/auth') as unknown as { getSession: ReturnType<typeof vi.fn> }
    getSession.mockResolvedValue({ user: { id: employer.id } })
    await expect(requireCompanyMember('RECRUITER', new Headers())).rejects.toBeInstanceOf(ForbiddenError)
  })
})
