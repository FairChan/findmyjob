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
import { requireUser, requireStudent, requireEmployer, requireCompanyMember, requireVerifiedCompany, requireAdmin } from '@/server/authz'
import { ForbiddenError, NotFoundError } from '@/server/errors'
import * as authMod from '@/server/auth'
import { viewTalentProfile } from '@/server/services/talent-view'
import { searchTalents } from '@/server/services/talent-search'
import {
  listFolders,
  createFolder,
  addToFolder,
  removeFromFolder,
  getFolderItems,
  getStudentFolderIds,
} from '@/server/services/talent-folders'

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
      } as never,
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

// ---------------------------------------------------------------------------
// requireEmployer — M1-T09 page guard for /e layout
// ---------------------------------------------------------------------------

describe('requireEmployer (M1-T09)', () => {
  it('guest → ForbiddenError', async () => {
    mockSession(null)
    await expect(requireEmployer(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('active employer → pass', async () => {
    const { userId } = await createEmployer(testDb)
    mockSession(userId)
    const ctx = await requireEmployer(noHeaders)
    expect(ctx.userId).toBe(userId)
  })

  it('student → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    await expect(requireEmployer(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('suspended employer → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })
    mockSession(userId)
    await expect(requireEmployer(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('employer with no company yet → pass (onboarding accessible)', async () => {
    const user = await testDb.user.create({
      data: { name: 'Emp No Co', email: 'emp-noco@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    mockSession(user.id)
    const ctx = await requireEmployer(noHeaders)
    expect(ctx.userId).toBe(user.id)
  })
})

// ---------------------------------------------------------------------------
// talent.view (M4-T05): viewTalentProfile authz
// ---------------------------------------------------------------------------

describe('talent.view: viewTalentProfile authz', () => {
  async function makeVisible(profileId: string) {
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
    })
  }

  it('verified employer can view a visible student profile', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await makeVisible(profileId)

    const detail = await viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId)
    expect(detail.id).toBe(profileId)
  })

  it('company A cannot view a student blocked from them', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await makeVisible(profileId)
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId: emp.companyId } })

    await expect(
      viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('company B cannot view a HIDDEN student (returns NotFoundError, not data leak)', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    // Student visibility stays HIDDEN

    await expect(
      viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ---------------------------------------------------------------------------
// talent.folders (M4-T11): folder authz
// ---------------------------------------------------------------------------

describe('talent.folders: folder access control', () => {
  async function makeVisible(profileId: string) {
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
    })
  }

  it('employer can create and list folders for own company', async () => {
    const emp = await createEmployer(testDb)
    const ctx = { userId: emp.userId, companyId: emp.companyId }

    const folder = await createFolder(ctx, { name: 'Test Folder' })
    expect(folder.id).toBeTruthy()

    const folders = await listFolders(ctx)
    expect(folders.some((f) => f.id === folder.id)).toBe(true)
  })

  it('company A cannot access folders from company B', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)

    const folderB = await createFolder(
      { userId: empB.userId, companyId: empB.companyId },
      { name: 'Company B Folder' },
    )

    // Company A should not see company B's folders
    const foldersA = await listFolders({ userId: empA.userId, companyId: empA.companyId })
    expect(foldersA.some((f) => f.id === folderB.id)).toBe(false)
  })

  it('company A cannot view folder items from company B', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)

    // Verify A so the ownership check (not the verification gate) is exercised
    await testDb.company.update({
      where: { id: empA.companyId },
      data: { verificationStatus: 'VERIFIED' },
    })

    const folderB = await createFolder(
      { userId: empB.userId, companyId: empB.companyId },
      { name: 'Company B Folder' },
    )

    await expect(
      getFolderItems({ userId: empA.userId, companyId: empA.companyId }, folderB.id),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('addToFolder checks student visibility — hidden student is rejected', async () => {
    const emp = await createEmployer(testDb)
    const { profileId } = await createStudent(testDb)
    // Student stays HIDDEN

    const folder = await createFolder(
      { userId: emp.userId, companyId: emp.companyId },
      { name: 'Folder' },
    )

    await expect(
      addToFolder(
        { userId: emp.userId, companyId: emp.companyId },
        { folderId: folder.id, studentId: profileId },
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('addToFolder succeeds for a visible student, duplicate upsert is idempotent', async () => {
    const emp = await createEmployer(testDb)
    const { profileId } = await createStudent(testDb)
    await makeVisible(profileId)

    const folder = await createFolder(
      { userId: emp.userId, companyId: emp.companyId },
      { name: 'Folder' },
    )

    await addToFolder(
      { userId: emp.userId, companyId: emp.companyId },
      { folderId: folder.id, studentId: profileId },
    )
    // Second call must not throw (upsert, not insert)
    await expect(
      addToFolder(
        { userId: emp.userId, companyId: emp.companyId },
        { folderId: folder.id, studentId: profileId },
      ),
    ).resolves.not.toThrow()
  })

  it('getStudentFolderIds returns only folders from the requesting company', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    const { profileId } = await createStudent(testDb)
    await makeVisible(profileId)

    const folderA = await createFolder(
      { userId: empA.userId, companyId: empA.companyId },
      { name: 'Folder A' },
    )
    await addToFolder(
      { userId: empA.userId, companyId: empA.companyId },
      { folderId: folderA.id, studentId: profileId },
    )

    const idsFromA = await getStudentFolderIds(
      { userId: empA.userId, companyId: empA.companyId },
      profileId,
    )
    const idsFromB = await getStudentFolderIds(
      { userId: empB.userId, companyId: empB.companyId },
      profileId,
    )
    expect(idsFromA).toContain(folderA.id)
    expect(idsFromB).not.toContain(folderA.id)
  })

  it('removeFromFolder only removes from own company folder', async () => {
    const emp = await createEmployer(testDb)
    const { profileId } = await createStudent(testDb)
    await makeVisible(profileId)

    const folder = await createFolder(
      { userId: emp.userId, companyId: emp.companyId },
      { name: 'Folder' },
    )
    await addToFolder(
      { userId: emp.userId, companyId: emp.companyId },
      { folderId: folder.id, studentId: profileId },
    )
    await removeFromFolder(
      { userId: emp.userId, companyId: emp.companyId },
      { folderId: folder.id, studentId: profileId },
    )

    const ids = await getStudentFolderIds(
      { userId: emp.userId, companyId: emp.companyId },
      profileId,
    )
    expect(ids).not.toContain(folder.id)
  })
})

// ---------------------------------------------------------------------------
// 未认证企业（M4-T14）: verified company gate on talent operations
// ---------------------------------------------------------------------------

describe('未认证企业搜索人才被拒', () => {
  it('unverified company calling searchTalents → ForbiddenError', async () => {
    const emp = await createEmployer(testDb)
    // createEmployer leaves verificationStatus=UNSUBMITTED
    await expect(
      searchTalents({ userId: emp.userId, companyId: emp.companyId }, {}),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('未认证企业查看收藏夹被拒', () => {
  it('unverified company calling getFolderItems → ForbiddenError', async () => {
    const emp = await createEmployer(testDb)
    // Need a folder ID; use a fake one (the company check fires first)
    await expect(
      getFolderItems({ userId: emp.userId, companyId: emp.companyId }, 'doesnotexist00000000000000'),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
