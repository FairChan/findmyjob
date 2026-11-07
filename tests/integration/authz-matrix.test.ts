/**
 * Authorization matrix integration tests.
 *
 * Table-driven: each row represents (action, actor, expected outcome).
 * Future tasks add rows as new sensitive operations are implemented.
 *
 * Session is mocked; the DB is real (findmyjob_test via TEST_DATABASE_URL).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { clearSettingsCache } from '@/server/services/settings'

// Mock must be declared before any imports that transitively pull in the module.
vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('@/lib/storage', () => ({
  deleteAllVersions: vi.fn().mockResolvedValue(undefined),
  getSignedUploadUrl: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
  getObjectBytes: vi.fn(),
}))

vi.mock('pdf-lib', () => {
  function makeDoc() {
    return {
      getPageCount: vi.fn().mockReturnValue(1),
      copyPages: vi.fn().mockResolvedValue([{
        getSize: vi.fn().mockReturnValue({ width: 612, height: 792 }),
        drawText: vi.fn(),
      }]),
      embedFont: vi.fn().mockResolvedValue({ widthOfTextAtSize: vi.fn().mockReturnValue(100) }),
      addPage: vi.fn(),
      save: vi.fn().mockResolvedValue(new Uint8Array()),
      catalog: { has: vi.fn().mockReturnValue(false) },
    }
  }
  return {
    PDFDocument: {
      load: vi.fn().mockImplementation(() => Promise.resolve(makeDoc())),
      create: vi.fn().mockImplementation(() => Promise.resolve(makeDoc())),
    },
    StandardFonts: { Helvetica: 'Helvetica' },
    rgb: vi.fn().mockReturnValue({}),
    degrees: vi.fn().mockReturnValue(0),
    PDFName: { of: vi.fn().mockReturnValue({}) },
  }
})

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createEmployerWithoutCompany } from '../factories'
import { requireUser, requireStudent, requireEmployer, requireCompanyMember, requireVerifiedCompany, requireAdmin } from '@/server/authz'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
import { createCompany, updateCompany } from '@/server/services/company'
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
import { getContactForCompany } from '@/server/services/contact-access'

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
// Team management authz (M3-T04)
// ---------------------------------------------------------------------------

describe('team management authz (M3-T04)', () => {
  async function seedTeamSettings() {
    for (const [key, val] of [['team.maxMembers', 3], ['team.maxInvitesPerDay', 3]] as const) {
      await testDb.systemSetting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(val) },
        update: { value: JSON.stringify(val) },
      })
    }
  }

  it('RECRUITER cannot invite members', async () => {
    await seedTeamSettings()
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'RECRUITER' } })
    const { inviteMember } = await import('@/server/services/team')
    await expect(
      inviteMember({ userId, companyId, role: 'RECRUITER' }, { email: 'x@example.test', role: 'RECRUITER' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('OWNER cannot be removed', async () => {
    await seedTeamSettings()
    const { userId, companyId } = await createEmployer(testDb)
    const ownerMember = await testDb.companyMember.findFirst({ where: { userId, companyId } })
    const { removeMember } = await import('@/server/services/team')
    await expect(
      removeMember({ userId, companyId, role: 'OWNER' }, { memberId: ownerMember!.id }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('OWNER cannot be demoted', async () => {
    await seedTeamSettings()
    const { userId, companyId } = await createEmployer(testDb)
    const ownerMember = await testDb.companyMember.findFirst({ where: { userId, companyId } })
    const { changeRole } = await import('@/server/services/team')
    await expect(
      changeRole({ userId, companyId, role: 'OWNER' }, { memberId: ownerMember!.id, role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('cross-company: cannot remove member of a different company', async () => {
    await seedTeamSettings()
    const { userId: ownerA, companyId: companyA } = await createEmployer(testDb)
    const { userId: ownerB, companyId: companyB } = await createEmployer(testDb)
    const memberB = await testDb.companyMember.findFirst({ where: { companyId: companyB } })
    const { removeMember } = await import('@/server/services/team')
    await expect(
      removeMember({ userId: ownerA, companyId: companyA, role: 'OWNER' }, { memberId: memberB!.id }),
    ).rejects.toThrow()
  })

  it('invite email mismatch → ForbiddenError on accept', async () => {
    await seedTeamSettings()
    const { userId: ownerUserId } = await createEmployer(testDb)
    const ownerMember = await testDb.companyMember.findFirst({ where: { userId: ownerUserId } })
    const { inviteMember, acceptInvite } = await import('@/server/services/team')
    const { token } = await inviteMember(
      { userId: ownerUserId, companyId: ownerMember!.companyId, role: 'OWNER' },
      { email: 'right@example.test', role: 'RECRUITER' },
    )
    const wrongUser = await testDb.user.create({
      data: { name: 'Wrong', email: 'wrong@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await expect(acceptInvite({ userId: wrongUser.id }, token)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('company service authz (M3-T01)', () => {
  it('createCompany: student → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    await expect(createCompany({ userId }, { legalName: 'No Co' })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('createCompany: employer already member → ValidationError', async () => {
    const { userId } = await createEmployer(testDb)
    await expect(createCompany({ userId }, { legalName: 'Second Co' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('createCompany: employer without company → creates company', async () => {
    const { userId } = await createEmployerWithoutCompany(testDb)
    const co = await createCompany({ userId }, { legalName: 'New Co Sdn Bhd' })
    expect(co.legalName).toBe('New Co Sdn Bhd')
  })

  it('updateCompanyAction: companyId comes from requireCompanyMember, not client input', async () => {
    // empA owns cid1; empB owns cid2.
    // When empA is logged in, the action must write to cid1 regardless of any client payload.
    // This test fails if the action starts trusting a client-supplied companyId instead.
    const { userId: uid1, companyId: cid1 } = await createEmployer(testDb)
    const { companyId: cid2 } = await createEmployer(testDb)
    mockSession(uid1)
    const { updateCompanyAction } = await import('@/server/actions/company')
    const result = await updateCompanyAction({ legalName: 'NewNameFromAction' })
    expect(result.ok).toBe(true)

    // Write went to cid1 (the authenticated company)
    const co1 = await testDb.company.findUnique({ where: { id: cid1 } })
    expect(co1?.legalName).toBe('NewNameFromAction')

    // cid2 was not touched
    const co2 = await testDb.company.findUnique({ where: { id: cid2 } })
    expect(co2?.legalName).not.toBe('NewNameFromAction')
  })

  it('updateCompanyAction: RECRUITER → FORBIDDEN', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'RECRUITER' } })
    // also re-activate just in case createEmployer set a different status
    await testDb.company.update({ where: { id: companyId }, data: { isActive: true } })
    mockSession(userId)
    const { updateCompanyAction } = await import('@/server/actions/company')
    const result = await updateCompanyAction({ legalName: 'ShouldBeBlocked' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('submitVerificationAction: RECRUITER → FORBIDDEN', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'RECRUITER' } })
    await testDb.company.update({ where: { id: companyId }, data: { isActive: true } })
    mockSession(userId)
    const { submitVerificationAction } = await import('@/server/actions/verification')
    const result = await submitVerificationAction({
      documentKeys: [`verifications/${companyId}/doc.pdf`],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('submitVerificationAction: documentKeys from another company → FORBIDDEN', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    const { companyId: otherId } = await createEmployer(testDb)
    mockSession(userId)
    const { submitVerificationAction } = await import('@/server/actions/verification')
    const result = await submitVerificationAction({
      documentKeys: [`verifications/${otherId}/doc.pdf`],
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
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
    // listFolders requires verified company
    await testDb.company.update({
      where: { id: emp.companyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    const ctx = { userId: emp.userId, companyId: emp.companyId }

    const folder = await createFolder(ctx, { name: 'Test Folder' })
    expect(folder.id).toBeTruthy()

    const folders = await listFolders(ctx)
    expect(folders.some((f) => f.id === folder.id)).toBe(true)
  })

  it('company A cannot access folders from company B', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    // Both must be verified to test isolation (not the verification gate)
    await testDb.company.update({
      where: { id: empA.companyId },
      data: { verificationStatus: 'VERIFIED' },
    })
    await testDb.company.update({
      where: { id: empB.companyId },
      data: { verificationStatus: 'VERIFIED' },
    })

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

  it('被撤销认证的企业列出收藏夹被拒 — listFolders → ForbiddenError', async () => {
    const emp = await createEmployer(testDb)
    // Set status to REJECTED (represents revoked/failed verification)
    await testDb.company.update({
      where: { id: emp.companyId },
      data: { verificationStatus: 'REJECTED' },
    })
    await expect(
      listFolders({ userId: emp.userId, companyId: emp.companyId }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// contact-access authz (M4-T08)
// ---------------------------------------------------------------------------

describe('contact-access: getContactForCompany authz', () => {
  async function makeVisible(profileId: string) {
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
    })
  }

  async function createUnlock(companyId: string, studentId: string, userId: string) {
    await testDb.creditWallet.upsert({
      where: { companyId },
      create: { companyId, balance: 10 },
      update: {},
    })
    return testDb.talentUnlock.create({
      data: { companyId, studentId, unlockedById: userId, source: 'CREDIT', creditsSpent: 1 },
    })
  }

  it('not unlocked → ForbiddenError', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await makeVisible(profileId)

    await expect(getContactForCompany(emp.companyId, profileId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('unlocked → returns contact (even if null fields)', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    const contact = await getContactForCompany(emp.companyId, profileId)
    expect(contact).toMatchObject({ phone: null, email: null })
  })

  it('student blocks company after unlock → ForbiddenError (TM-003)', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId: emp.companyId } })

    await expect(getContactForCompany(emp.companyId, profileId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('student suspended after unlock → ForbiddenError (TM-003)', async () => {
    const { profileId, userId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)
    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })

    await expect(getContactForCompany(emp.companyId, profileId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('cross-company: company B cannot access student unlocked by company A', async () => {
    const { profileId } = await createStudent(testDb)
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    await makeVisible(profileId)
    await createUnlock(empA.companyId, profileId, empA.userId)

    await expect(getContactForCompany(empB.companyId, profileId)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// admin-verification actions authz (M3-T03)
// ---------------------------------------------------------------------------

describe('admin-verification actions authz (M3-T03)', () => {
  async function makeVerification() {
    const { userId: ownerId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'PENDING' } })
    const cv = await testDb.companyVerification.create({
      data: {
        companyId,
        documentKeys: [`verifications/${companyId}/ssm.pdf`],
        status: 'PENDING',
        submittedById: ownerId,
      },
    })
    return { companyId, verificationId: cv.id }
  }

  it('approveCompanyAction: student → FORBIDDEN, company status unchanged', async () => {
    const { userId } = await createStudent(testDb)
    const { companyId, verificationId } = await makeVerification()
    mockSession(userId)
    const { approveCompanyAction } = await import('@/server/actions/admin-verification')
    const result = await approveCompanyAction({
      verificationId,
      verifiedChannels: ['SSM'],
      verificationResult: 'Confirmed',
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const co = await testDb.company.findUnique({ where: { id: companyId } })
    expect(co?.verificationStatus).toBe('PENDING')
  })

  it('approveCompanyAction: employer → FORBIDDEN, company status unchanged', async () => {
    const { userId } = await createEmployer(testDb)
    const { companyId, verificationId } = await makeVerification()
    mockSession(userId)
    const { approveCompanyAction } = await import('@/server/actions/admin-verification')
    const result = await approveCompanyAction({
      verificationId,
      verifiedChannels: ['SSM'],
      verificationResult: 'Confirmed',
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const co = await testDb.company.findUnique({ where: { id: companyId } })
    expect(co?.verificationStatus).toBe('PENDING')
  })

  it('rejectCompanyAction: student → FORBIDDEN, company status unchanged', async () => {
    const { userId } = await createStudent(testDb)
    const { companyId, verificationId } = await makeVerification()
    mockSession(userId)
    const { rejectCompanyAction } = await import('@/server/actions/admin-verification')
    const result = await rejectCompanyAction({ verificationId, reviewNote: 'Bad docs' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const co = await testDb.company.findUnique({ where: { id: companyId } })
    expect(co?.verificationStatus).toBe('PENDING')
  })

  it('rejectCompanyAction: employer → FORBIDDEN, company status unchanged', async () => {
    const { userId } = await createEmployer(testDb)
    const { companyId, verificationId } = await makeVerification()
    mockSession(userId)
    const { rejectCompanyAction } = await import('@/server/actions/admin-verification')
    const result = await rejectCompanyAction({ verificationId, reviewNote: 'Bad docs' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const co = await testDb.company.findUnique({ where: { id: companyId } })
    expect(co?.verificationStatus).toBe('PENDING')
  })
})

// ---------------------------------------------------------------------------
// admin-jobs actions authz (M5-T02)
// ---------------------------------------------------------------------------

describe('admin-jobs actions authz (M5-T02)', () => {
  async function makePendingJobFixture() {
    const { userId: ownerId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await testDb.job.create({
      data: {
        companyId,
        createdById: ownerId,
        title: 'Authz Test Job',
        type: 'INTERNSHIP',
        description: 'Test',
        status: 'PENDING_REVIEW',
        workMode: 'ONSITE',
      },
    })
    return { jobId: job.id, companyId }
  }

  it('approveJobAction: student → FORBIDDEN, job status unchanged', async () => {
    const { userId } = await createStudent(testDb)
    const { jobId } = await makePendingJobFixture()
    mockSession(userId)
    const { approveJobAction } = await import('@/server/actions/admin-jobs')
    const result = await approveJobAction({ jobId })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const job = await testDb.job.findUnique({ where: { id: jobId } })
    expect(job?.status).toBe('PENDING_REVIEW')
  })

  it('approveJobAction: employer → FORBIDDEN, job status unchanged', async () => {
    const { userId } = await createEmployer(testDb)
    const { jobId } = await makePendingJobFixture()
    mockSession(userId)
    const { approveJobAction } = await import('@/server/actions/admin-jobs')
    const result = await approveJobAction({ jobId })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const job = await testDb.job.findUnique({ where: { id: jobId } })
    expect(job?.status).toBe('PENDING_REVIEW')
  })

  it('rejectJobAction: student → FORBIDDEN, job status unchanged', async () => {
    const { userId } = await createStudent(testDb)
    const { jobId } = await makePendingJobFixture()
    mockSession(userId)
    const { rejectJobAction } = await import('@/server/actions/admin-jobs')
    const result = await rejectJobAction({ jobId, reviewNote: 'Bad job' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const job = await testDb.job.findUnique({ where: { id: jobId } })
    expect(job?.status).toBe('PENDING_REVIEW')
  })

  it('rejectJobAction: employer → FORBIDDEN, job status unchanged', async () => {
    const { userId } = await createEmployer(testDb)
    const { jobId } = await makePendingJobFixture()
    mockSession(userId)
    const { rejectJobAction } = await import('@/server/actions/admin-jobs')
    const result = await rejectJobAction({ jobId, reviewNote: 'Bad job' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const job = await testDb.job.findUnique({ where: { id: jobId } })
    expect(job?.status).toBe('PENDING_REVIEW')
  })
})

// ---------------------------------------------------------------------------
// managed-company authz (M6-T07)
// ---------------------------------------------------------------------------

describe('managed-company authz (M6-T07)', () => {
  it('createManagedCompany: student → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    const { createManagedCompany } = await import('@/server/services/managed-company')
    await expect(
      createManagedCompany({ userId }, { legalName: 'Test MC' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('createManagedCompany: employer → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    const { createManagedCompany } = await import('@/server/services/managed-company')
    await expect(
      createManagedCompany({ userId }, { legalName: 'Test MC2' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('postJobAsPlatform: employer on non-managed company → ForbiddenError', async () => {
    const admin = await testDb.user.create({
      data: { name: 'Admin MC', email: 'admin-mc-matrix@example.test', emailVerified: true, role: 'ADMIN', status: 'ACTIVE' },
    })
    const { userId: empId, companyId } = await createEmployer(testDb)
    const { postJobAsPlatform } = await import('@/server/services/managed-company')
    const jobInput = {
      title: 'Job', type: 'INTERNSHIP' as const, description: 'Desc',
      workMode: 'ONSITE' as const, submit: false, salaryVisible: true,
      acceptsStudentPass: false, sponsorsWorkPass: false, languages: [], skills: [],
    }
    await expect(postJobAsPlatform({ userId: empId }, companyId, jobInput)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(postJobAsPlatform({ userId: admin.id }, companyId, jobInput)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('transferCompany: missing verificationRecord → ValidationError', async () => {
    const admin = await testDb.user.create({
      data: { name: 'Admin MC2', email: 'admin-mc2-matrix@example.test', emailVerified: true, role: 'ADMIN', status: 'ACTIVE' },
    })
    const { createManagedCompany, transferCompany } = await import('@/server/services/managed-company')
    const company = await createManagedCompany({ userId: admin.id }, { legalName: `MCo-Authz-${Date.now()}` })
    await expect(
      transferCompany({ userId: admin.id }, company.id, { ownerEmail: 'x@example.test', verificationRecord: '', verificationMethod: 'PHONE_CALLBACK' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('acceptManagedTransfer: non-OWNER invite is rejected', async () => {
    const admin = await testDb.user.create({
      data: { name: 'Admin MC3', email: 'admin-mc3-matrix@example.test', emailVerified: true, role: 'ADMIN', status: 'ACTIVE' },
    })
    const { createManagedCompany, acceptManagedTransfer } = await import('@/server/services/managed-company')
    const company = await createManagedCompany({ userId: admin.id }, { legalName: `MCo-NOwner-${Date.now()}` })
    // Insert a non-OWNER invite directly
    const { createHash, randomBytes } = await import('crypto')
    const rawToken = randomBytes(32).toString('base64url')
    const hash = createHash('sha256').update(rawToken).digest('hex')
    const email = `non-owner-${Date.now()}@example.test`
    await testDb.companyInvite.create({
      data: {
        companyId: company.id,
        email,
        role: 'ADMIN',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdById: admin.id,
      },
    })
    const target = await testDb.user.create({
      data: { name: 'Target', email, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await expect(acceptManagedTransfer({ userId: target.id }, rawToken)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('acceptInvite: OWNER invite for non-managed company → ForbiddenError', async () => {
    const { acceptInvite } = await import('@/server/services/team')
    const { userId, companyId } = await createEmployer(testDb)
    const email = `owner-nm-${Date.now()}@example.test`
    const { createHash, randomBytes } = await import('crypto')
    const rawToken = randomBytes(32).toString('base64url')
    const hash = createHash('sha256').update(rawToken).digest('hex')
    await testDb.companyInvite.create({
      data: {
        companyId,
        email,
        role: 'OWNER',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdById: userId,
      },
    })
    const target = await testDb.user.create({
      data: { name: 'Target NM', email, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await expect(acceptInvite({ userId: target.id }, rawToken)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// jobs authz (M5-T01)
// ---------------------------------------------------------------------------

describe('jobs authz (M5-T01)', () => {
  async function makeJobForCompany(companyId: string, createdById: string) {
    return testDb.job.create({
      data: {
        companyId,
        createdById,
        title: 'Authz Job',
        type: 'INTERNSHIP',
        description: 'Test',
        status: 'PUBLISHED',
        workMode: 'ONSITE',
      },
    })
  }

  it('cross-company: updateJob by other employer → NotFoundError, job unchanged', async () => {
    const owner = await createEmployer(testDb)
    await testDb.company.update({ where: { id: owner.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const attacker = await createEmployer(testDb)
    const job = await makeJobForCompany(owner.companyId, owner.userId)

    const { updateJob: svcUpdateJob } = await import('@/server/services/jobs')
    const attackerCtx = { userId: attacker.userId, companyId: attacker.companyId, role: 'OWNER' as const }
    await expect(
      svcUpdateJob(attackerCtx, job.id, {
        title: 'Hacked', type: 'INTERNSHIP', description: 'Hacked',
        workMode: 'ONSITE', submit: false, salaryVisible: true,
        acceptsStudentPass: false, sponsorsWorkPass: false, languages: [], skills: [],
      }),
    ).rejects.toThrow()

    const unchanged = await testDb.job.findUnique({ where: { id: job.id } })
    expect(unchanged?.title).toBe('Authz Job')
  })

  it('cross-company: closeJob by other employer → NotFoundError, job remains PUBLISHED', async () => {
    const owner = await createEmployer(testDb)
    const attacker = await createEmployer(testDb)
    const job = await makeJobForCompany(owner.companyId, owner.userId)

    const { closeJob: svcCloseJob } = await import('@/server/services/jobs')
    const attackerCtx = { userId: attacker.userId, companyId: attacker.companyId, role: 'OWNER' as const }
    await expect(svcCloseJob(attackerCtx, job.id)).rejects.toThrow()

    const unchanged = await testDb.job.findUnique({ where: { id: job.id } })
    expect(unchanged?.status).toBe('PUBLISHED')
  })

  it('RECRUITER can update own company job', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'RECRUITER' } })
    const job = await makeJobForCompany(companyId, userId)

    const { updateJob: svcUpdateJob } = await import('@/server/services/jobs')
    const ctx = { userId, companyId, role: 'RECRUITER' as const }
    const updated = await svcUpdateJob(ctx, job.id, {
      title: 'Updated by Recruiter', type: 'INTERNSHIP', description: 'Test',
      workMode: 'ONSITE', submit: false, salaryVisible: true,
      acceptsStudentPass: false, sponsorsWorkPass: false, languages: [], skills: [],
    })
    // PUBLISHED + sensitive change → PENDING_REVIEW (approvedJobCount=0 < 1000)
    expect(updated.status).toBe('PENDING_REVIEW')
    expect(updated.title).toBe('Updated by Recruiter')
  })

  it('RECRUITER can close own company job', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'RECRUITER' } })
    const job = await makeJobForCompany(companyId, userId)

    const { closeJob: svcCloseJob } = await import('@/server/services/jobs')
    const ctx = { userId, companyId, role: 'RECRUITER' as const }
    const closed = await svcCloseJob(ctx, job.id)
    expect(closed.status).toBe('CLOSED')
  })
})

// ---------------------------------------------------------------------------
// talent.unlock (M4-T07): unlock service authz
// ---------------------------------------------------------------------------

describe('talent.unlock: unlockStudent authz', () => {
  async function setupUnlockSettings() {
    for (const [k, v] of [
      ['unlock.enabled', true],
      ['unlock.costCredits', 1],
      ['limits.unlocksPerDay', 50],
      ['talentPool.minCompleteness', 60],
    ] as const) {
      await testDb.systemSetting.upsert({
        where: { key: k },
        create: { key: k, value: v as Parameters<typeof testDb.systemSetting.create>[0]['data']['value'] },
        update: { value: v as Parameters<typeof testDb.systemSetting.create>[0]['data']['value'] },
      })
    }
    clearSettingsCache()
  }

  it('verified employer can unlock a visible student', async () => {
    await setupUnlockSettings()
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 5 } })
    const { profileId } = await createStudent(testDb, { completeness: 80 })
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
    })
    const { unlockStudent } = await import('@/server/services/unlock')
    const result = await unlockStudent({ userId: emp.userId, companyId: emp.companyId }, profileId)
    expect(result.alreadyUnlocked).toBe(false)
  })

  it('company A cannot unlock student by passing company B id — companyId fixed by authz', async () => {
    await setupUnlockSettings()
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    await testDb.company.update({ where: { id: empA.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.creditWallet.create({ data: { companyId: empA.companyId, balance: 5 } })
    const { profileId } = await createStudent(testDb, { completeness: 80 })
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
    })
    // empA's unlock uses empA.companyId, cannot pass empB.companyId via action
    const { unlockStudent } = await import('@/server/services/unlock')
    const result = await unlockStudent({ userId: empA.userId, companyId: empA.companyId }, profileId)
    expect(result.alreadyUnlocked).toBe(false)
    const unlock = await testDb.talentUnlock.findFirst({ where: { studentId: profileId } })
    expect(unlock?.companyId).toBe(empA.companyId)
    expect(unlock?.companyId).not.toBe(empB.companyId)
  })

  it('blocked student → NotFoundError (TM-003)', async () => {
    await setupUnlockSettings()
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 5 } })
    const { profileId } = await createStudent(testDb, { completeness: 80 })
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
    })
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId: emp.companyId } })
    const { unlockStudent } = await import('@/server/services/unlock')
    await expect(
      unlockStudent({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('hidden student → NotFoundError, no charge', async () => {
    await setupUnlockSettings()
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 5 } })
    const { profileId } = await createStudent(testDb, { completeness: 80 })
    // Profile stays HIDDEN
    const { unlockStudent } = await import('@/server/services/unlock')
    await expect(
      unlockStudent({ userId: emp.userId, companyId: emp.companyId }, profileId),
    ).rejects.toBeInstanceOf(NotFoundError)
    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } })
    expect(wallet?.balance).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// resume download ownership (M2-T05)
// ---------------------------------------------------------------------------

describe('resume download ownership (M2-T05)', () => {
  it('student B downloading student A resume → 404, getSignedDownloadUrl not called', async () => {
    const a = await createStudent(testDb)
    const b = await createStudent(testDb)
    const resume = await testDb.resumeFile.create({
      data: {
        studentId: a.profileId,
        storageKey: 'resumes/authz-a/cv.pdf',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    })
    const { getSignedDownloadUrl } = await import('@/lib/storage')
    mockSession(b.userId)
    const { GET } = await import('@/app/api/resumes/[id]/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resume.id}`))
    expect(res.status).toBe(404)
    expect(vi.mocked(getSignedDownloadUrl)).not.toHaveBeenCalled()
  })

  it('invalid (non-cuid) resume id → 400, getSignedDownloadUrl not called', async () => {
    const { userId } = await createStudent(testDb)
    const { getSignedDownloadUrl } = await import('@/lib/storage')
    mockSession(userId)
    const { GET } = await import('@/app/api/resumes/[id]/route')
    const res = await GET(new Request('http://localhost/api/resumes/not-a-cuid'))
    expect(res.status).toBe(400)
    expect(vi.mocked(getSignedDownloadUrl)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// resume.download (M4-T09): watermarked PDF download authz
// ---------------------------------------------------------------------------

describe('resume.download (M4-T09)', () => {
  async function makeStudentWithResume() {
    const { profileId } = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
    })
    const resume = await testDb.resumeFile.create({
      data: {
        studentId: profileId,
        storageKey: 'resumes/dl-authz-test/cv.pdf',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    })
    return { profileId, resumeId: resume.id }
  }

  async function createUnlock(companyId: string, studentId: string, unlockedById: string) {
    await testDb.creditWallet.upsert({
      where: { companyId },
      create: { companyId, balance: 10 },
      update: {},
    })
    return testDb.talentUnlock.create({
      data: { companyId, studentId, unlockedById, source: 'CREDIT', creditsSpent: 1 },
    })
  }

  it('no TalentUnlock → 403', async () => {
    const { resumeId } = await makeStudentWithResume()
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    mockSession(emp.userId)
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(403)
  })

  it('student blocks company after unlock → 403 (TM-003)', async () => {
    const { profileId, resumeId } = await makeStudentWithResume()
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await createUnlock(emp.companyId, profileId, emp.userId)
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId: emp.companyId } })
    mockSession(emp.userId)
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(403)
  })

  it('valid access + mocked PDF → 200 application/pdf, Cache-Control: no-store', async () => {
    const { profileId, resumeId } = await makeStudentWithResume()
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await createUnlock(emp.companyId, profileId, emp.userId)
    const { getObjectBytes } = await import('@/lib/storage')
    vi.mocked(getObjectBytes).mockResolvedValueOnce(Buffer.from([37, 80, 68, 70]))
    mockSession(emp.userId)
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('resume not in DB → 404', async () => {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    mockSession(emp.userId)
    // Use a fake-but-valid-looking cuid
    const fakeId = 'clzzzzzzzzzzzzzzzzzzzzzzzz'
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${fakeId}/download`))
    expect(res.status).toBe(404)
  })
})
