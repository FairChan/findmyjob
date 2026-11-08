/**
 * Integration tests for admin-users service.
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
  searchStudents,
  getStudentAdminDetail,
  grantJobViewQuota,
  approveSchoolVerificationManually,
  suspendUser,
  restoreUser,
} from '@/server/services/admin-users'
import { ForbiddenError, NotFoundError } from '@/server/errors'

setupTestDb()

async function createAdmin() {
  return testDb.user.create({
    data: {
      name: 'Admin',
      email: `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      emailVerified: true,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  })
}

async function createStudentUser() {
  const user = await testDb.user.create({
    data: {
      name: 'Test Student',
      email: `student-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      emailVerified: true,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  })
  const profile = await testDb.studentProfile.create({
    data: { userId: user.id, fullName: user.name, completeness: 50 },
  })
  return { userId: user.id, profileId: profile.id }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('searchStudents', () => {
  it('requires admin role — employer is rejected', async () => {
    const employer = await testDb.user.create({
      data: {
        name: 'Emp',
        email: `emp-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    await expect(
      searchStudents({ userId: employer.id }, { page: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('returns students matching name query', async () => {
    const admin = await createAdmin()
    const { userId } = await createStudentUser()
    await testDb.studentProfile.update({
      where: { userId },
      data: { fullName: 'UniqueSearchableName' },
    })
    const { items } = await searchStudents({ userId: admin.id }, { q: 'UniqueSearchable', page: 1 })
    expect(items.some((s) => s.userId === userId)).toBe(true)
  })

  it('filters by status=SUSPENDED', async () => {
    const admin = await createAdmin()
    const { userId } = await createStudentUser()
    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })
    const { items } = await searchStudents({ userId: admin.id }, { status: 'SUSPENDED', page: 1 })
    expect(items.some((s) => s.userId === userId)).toBe(true)
    expect(items.every((s) => s.status === 'SUSPENDED')).toBe(true)
  })

  it('paginated — total reflects full count', async () => {
    const admin = await createAdmin()
    // Create 3 students
    await Promise.all([createStudentUser(), createStudentUser(), createStudentUser()])
    const { total } = await searchStudents({ userId: admin.id }, { page: 1 })
    expect(total).toBeGreaterThanOrEqual(3)
  })
})

describe('getStudentAdminDetail', () => {
  it('returns full detail for a student', async () => {
    const admin = await createAdmin()
    const { userId } = await createStudentUser()
    const detail = await getStudentAdminDetail({ userId: admin.id }, userId)
    expect(detail.userId).toBe(userId)
    expect(detail.email).toBeTruthy()
  })

  it('throws NotFoundError for non-student user', async () => {
    const admin = await createAdmin()
    const employer = await testDb.user.create({
      data: {
        name: 'Emp',
        email: `emp2-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    await expect(
      getStudentAdminDetail({ userId: admin.id }, employer.id),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('non-admin cannot call getStudentAdminDetail', async () => {
    const { userId: studentId } = await createStudentUser()
    const { userId: targetId } = await createStudentUser()
    await expect(
      getStudentAdminDetail({ userId: studentId }, targetId),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('grantJobViewQuota', () => {
  it('creates a JobViewGrant with ADMIN_GRANT source', async () => {
    const admin = await createAdmin()
    const { userId, profileId } = await createStudentUser()

    await grantJobViewQuota({ userId: admin.id }, {
      studentUserId: userId,
      amount: 15,
      note: 'Integration test grant',
    })

    const grants = await testDb.jobViewGrant.findMany({ where: { studentId: profileId } })
    expect(grants).toHaveLength(1)
    expect(grants[0].source).toBe('ADMIN_GRANT')
    expect(grants[0].amount).toBe(15)
    expect(grants[0].note).toBe('Integration test grant')
  })

  it('non-admin is rejected', async () => {
    const { userId: studentId } = await createStudentUser()
    const { userId: targetId } = await createStudentUser()
    await expect(
      grantJobViewQuota({ userId: studentId }, { studentUserId: targetId, amount: 5, note: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('concurrent grants both succeed independently', async () => {
    const admin = await createAdmin()
    const { userId, profileId } = await createStudentUser()

    await Promise.all([
      grantJobViewQuota({ userId: admin.id }, { studentUserId: userId, amount: 5, note: 'concurrent-a' }),
      grantJobViewQuota({ userId: admin.id }, { studentUserId: userId, amount: 10, note: 'concurrent-b' }),
    ])

    const grants = await testDb.jobViewGrant.findMany({ where: { studentId: profileId } })
    expect(grants).toHaveLength(2)
    const total = grants.reduce((sum, g) => sum + g.amount, 0)
    expect(total).toBe(15)
  })
})

describe('approveSchoolVerificationManually', () => {
  it('sets schoolVerifiedAt on the student profile', async () => {
    const admin = await createAdmin()
    const { userId, profileId } = await createStudentUser()

    const before = await testDb.studentProfile.findUnique({ where: { id: profileId }, select: { schoolVerifiedAt: true } })
    expect(before?.schoolVerifiedAt).toBeNull()

    await approveSchoolVerificationManually({ userId: admin.id }, userId)

    const after = await testDb.studentProfile.findUnique({ where: { id: profileId }, select: { schoolVerifiedAt: true } })
    expect(after?.schoolVerifiedAt).not.toBeNull()
  })

  it('non-admin is rejected', async () => {
    const { userId: studentId } = await createStudentUser()
    const { userId: targetId } = await createStudentUser()
    await expect(
      approveSchoolVerificationManually({ userId: studentId }, targetId),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('suspendUser', () => {
  it('sets user status to SUSPENDED and deletes sessions', async () => {
    const admin = await createAdmin()
    const { userId } = await createStudentUser()

    // Create a session for the student
    await testDb.session.create({
      data: {
        userId,
        token: `tok-${Date.now()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    await suspendUser({ userId: admin.id }, { targetUserId: userId, reason: 'test suspend' })

    const user = await testDb.user.findUnique({ where: { id: userId }, select: { status: true } })
    expect(user?.status).toBe('SUSPENDED')

    const sessions = await testDb.session.findMany({ where: { userId } })
    expect(sessions).toHaveLength(0)
  })

  it('writes user.suspend and auth.session.revoke audit logs', async () => {
    const admin = await createAdmin()
    const { userId } = await createStudentUser()

    await suspendUser({ userId: admin.id }, { targetUserId: userId, reason: 'audit test' })

    const audits = await testDb.auditLog.findMany({
      where: { targetId: userId, actorId: admin.id },
      select: { action: true },
    })
    const actions = audits.map((a) => a.action)
    expect(actions).toContain('user.suspend')
    expect(actions).toContain('auth.session.revoke')
  })

  it('non-admin is rejected', async () => {
    const { userId: studentId } = await createStudentUser()
    const { userId: targetId } = await createStudentUser()
    await expect(
      suspendUser({ userId: studentId }, { targetUserId: targetId, reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('suspending an employer is rejected (NotFoundError)', async () => {
    const admin = await createAdmin()
    const employer = await testDb.user.create({
      data: {
        name: 'Emp',
        email: `emp3-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    await expect(
      suspendUser({ userId: admin.id }, { targetUserId: employer.id, reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('concurrent suspensions are idempotent — user ends up SUSPENDED once', async () => {
    const admin = await createAdmin()
    const { userId } = await createStudentUser()

    await Promise.all([
      suspendUser({ userId: admin.id }, { targetUserId: userId, reason: 'concurrent-a' }),
      suspendUser({ userId: admin.id }, { targetUserId: userId, reason: 'concurrent-b' }),
    ])

    const user = await testDb.user.findUnique({ where: { id: userId }, select: { status: true } })
    expect(user?.status).toBe('SUSPENDED')
  })
})

describe('restoreUser', () => {
  it('sets suspended user status back to ACTIVE', async () => {
    const admin = await createAdmin()
    const { userId } = await createStudentUser()

    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })
    await restoreUser({ userId: admin.id }, { targetUserId: userId })

    const user = await testDb.user.findUnique({ where: { id: userId }, select: { status: true } })
    expect(user?.status).toBe('ACTIVE')
  })

  it('non-admin is rejected', async () => {
    const { userId: studentId } = await createStudentUser()
    const { userId: targetId } = await createStudentUser()
    await testDb.user.update({ where: { id: targetId }, data: { status: 'SUSPENDED' } })
    await expect(
      restoreUser({ userId: studentId }, { targetUserId: targetId }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('restoring an employer is rejected (NotFoundError)', async () => {
    const admin = await createAdmin()
    const employer = await testDb.user.create({
      data: {
        name: 'Emp Susp',
        email: `emp4-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'SUSPENDED',
      },
    })
    await expect(
      restoreUser({ userId: admin.id }, { targetUserId: employer.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
