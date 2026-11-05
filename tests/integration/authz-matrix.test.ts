/**
 * Authorization matrix integration tests.
 *
 * Table-driven: each row represents (action, actor, expected outcome).
 * Future tasks add rows as new sensitive operations are implemented.
 *
 * Session is mocked; the DB is real (findmyjob_test via TEST_DATABASE_URL).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock must be declared before any imports that transitively pull in the module.
vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import { requireUser, requireStudent, requireCompanyMember, requireVerifiedCompany, requireAdmin } from '@/server/authz'
import { ForbiddenError } from '@/server/errors'
import * as authMod from '@/server/auth'

setupTestDb()

const noHeaders = new Headers()

function mockSession(userId: string | null) {
  if (userId === null) {
    vi.mocked(authMod.getSession).mockResolvedValue(null)
  } else {
    vi.mocked(authMod.getSession).mockResolvedValue({
      user: {
        id: userId,
        name: '',
        email: '',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        image: null,
        role: 'STUDENT',
        locale: 'zh',
        status: 'ACTIVE',
      },
      session: {
        id: '',
        userId,
        token: '',
        expiresAt: new Date(Date.now() + 86_400_000),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// requireUser
// ---------------------------------------------------------------------------

describe('requireUser', () => {
  it('guest (no session) → ForbiddenError', async () => {
    mockSession(null)
    await expect(requireUser(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('active student → pass', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    const ctx = await requireUser(noHeaders)
    expect(ctx.userId).toBe(userId)
  })

  it('suspended user → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })
    mockSession(userId)
    await expect(requireUser(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('deleted user → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    await testDb.user.update({ where: { id: userId }, data: { status: 'DELETED' } })
    mockSession(userId)
    await expect(requireUser(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// requireStudent
// ---------------------------------------------------------------------------

describe('requireStudent', () => {
  it('guest → ForbiddenError', async () => {
    mockSession(null)
    await expect(requireStudent(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('active student → pass', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    const ctx = await requireStudent(noHeaders)
    expect(ctx.userId).toBe(userId)
  })

  it('employer → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    mockSession(userId)
    await expect(requireStudent(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin user → ForbiddenError', async () => {
    const admin = await testDb.user.create({
      data: { name: 'Admin', email: 'admin-matrix@example.test', emailVerified: true, role: 'ADMIN', status: 'ACTIVE' },
    })
    mockSession(admin.id)
    await expect(requireStudent(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('suspended student → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })
    mockSession(userId)
    await expect(requireStudent(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// requireCompanyMember
// ---------------------------------------------------------------------------

describe('requireCompanyMember', () => {
  it('guest → ForbiddenError', async () => {
    mockSession(null)
    await expect(requireCompanyMember('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('student → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    await expect(requireCompanyMember('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('employer in own company (OWNER role) → pass, returns correct companyId', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    mockSession(userId)
    const ctx = await requireCompanyMember('RECRUITER', noHeaders)
    expect(ctx.userId).toBe(userId)
    expect(ctx.companyId).toBe(companyId)
    expect(ctx.role).toBe('OWNER')
  })

  it('employer with RECRUITER role requesting ADMIN → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    // Downgrade the member role to RECRUITER
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'RECRUITER' } })
    mockSession(userId)
    await expect(requireCompanyMember('ADMIN', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('employer from company A cannot access company B data via requireCompanyMember', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    // empA should only see their own companyId
    mockSession(empA.userId)
    const ctx = await requireCompanyMember('RECRUITER', noHeaders)
    expect(ctx.companyId).toBe(empA.companyId)
    expect(ctx.companyId).not.toBe(empB.companyId)
  })

  it('suspended employer → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })
    mockSession(userId)
    await expect(requireCompanyMember('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('inactive company → ForbiddenError', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { isActive: false } })
    mockSession(userId)
    await expect(requireCompanyMember('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// requireVerifiedCompany
// ---------------------------------------------------------------------------

describe('requireVerifiedCompany', () => {
  it('unverified employer → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    // createEmployer sets verificationStatus=UNSUBMITTED
    mockSession(userId)
    await expect(requireVerifiedCompany('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('verified employer → pass', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    mockSession(userId)
    const ctx = await requireVerifiedCompany('RECRUITER', noHeaders)
    expect(ctx.userId).toBe(userId)
    expect(ctx.companyId).toBe(companyId)
  })

  it('pending verification → ForbiddenError', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'PENDING' } })
    mockSession(userId)
    await expect(requireVerifiedCompany('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe('requireAdmin', () => {
  it('guest → ForbiddenError', async () => {
    mockSession(null)
    await expect(requireAdmin(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('student → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    await expect(requireAdmin(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('employer → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    mockSession(userId)
    await expect(requireAdmin(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin user → pass', async () => {
    const admin = await testDb.user.create({
      data: { name: 'Admin', email: 'admin2-matrix@example.test', emailVerified: true, role: 'ADMIN', status: 'ACTIVE' },
    })
    mockSession(admin.id)
    const ctx = await requireAdmin(noHeaders)
    expect(ctx.userId).toBe(admin.id)
  })

  it('suspended admin → ForbiddenError', async () => {
    const admin = await testDb.user.create({
      data: { name: 'Admin', email: 'admin3-matrix@example.test', emailVerified: true, role: 'ADMIN', status: 'SUSPENDED' },
    })
    mockSession(admin.id)
    await expect(requireAdmin(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// Registration authz invariants (M1-T08)
// These rows verify that registration creates users with the correct role
// and that employer registration context does not bleed into student checks.
// ---------------------------------------------------------------------------

describe('registration role invariants (M1-T08)', () => {
  it('student created via factory has role STUDENT', async () => {
    const { userId } = await createStudent(testDb)
    const user = await testDb.user.findUnique({ where: { id: userId } })
    expect(user?.role).toBe('STUDENT')
  })

  it('employer created via factory has role EMPLOYER', async () => {
    const { userId } = await createEmployer(testDb)
    const user = await testDb.user.findUnique({ where: { id: userId } })
    expect(user?.role).toBe('EMPLOYER')
  })

  it('student cannot access employer guard (requireCompanyMember)', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    await expect(requireCompanyMember('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('employer cannot access student guard (requireStudent)', async () => {
    const { userId } = await createEmployer(testDb)
    mockSession(userId)
    await expect(requireStudent(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
