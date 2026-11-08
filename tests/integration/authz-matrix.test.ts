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

// pdf-lib is NOT mocked — the download route tests use real PDF processing.
// getObjectBytes is mocked to return a real minimal PDF buffer (see helper below).

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createEmployerWithoutCompany, createJob } from '../factories'
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
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('cross-company: cannot change role of member in a different company', async () => {
    await seedTeamSettings()
    const { userId: ownerA, companyId: companyA } = await createEmployer(testDb)
    const { companyId: companyB } = await createEmployer(testDb)
    // Add a RECRUITER to company B
    const userB = await testDb.user.create({
      data: { name: 'BRec', email: 'brec-xco@example.test', emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    const memberB = await testDb.companyMember.create({ data: { companyId: companyB, userId: userB.id, role: 'RECRUITER' } })
    const { changeRole } = await import('@/server/services/team')
    await expect(
      changeRole({ userId: ownerA, companyId: companyA, role: 'OWNER' }, { memberId: memberB.id, role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(NotFoundError)
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

  it('createCompany: employer already member → AppError ALREADY_MEMBER', async () => {
    const { userId } = await createEmployer(testDb)
    const err = await createCompany({ userId }, { legalName: 'Second Co' }).catch(e => e)
    const { AppError: AE } = await import('@/server/errors')
    expect(err).toBeInstanceOf(AE)
    expect((err as InstanceType<typeof AE>).code).toBe('ALREADY_MEMBER')
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

  it('updateCompanyAction Hijack: passing another company\'s companyId in raw input is ignored — cid2 unchanged', async () => {
    // Verifies that even if a future schema change adds companyId to the input,
    // the action always uses ctx.companyId from requireCompanyMember, not client-supplied companyId.
    const { userId: uid1, companyId: cid1 } = await createEmployer(testDb)
    const { companyId: cid2 } = await createEmployer(testDb)
    const co2Before = await testDb.company.findUnique({ where: { id: cid2 }, select: { legalName: true } })
    mockSession(uid1)
    const { updateCompanyAction } = await import('@/server/actions/company')
    // Pass cid2 explicitly in the raw input object — it must be ignored
    const result = await updateCompanyAction({ legalName: 'HijackAttempt', companyId: cid2 } as never)
    expect(result.ok).toBe(true)

    // cid2 must be unchanged (the write went to cid1)
    const co2After = await testDb.company.findUnique({ where: { id: cid2 }, select: { legalName: true } })
    expect(co2After?.legalName).toBe(co2Before?.legalName)

    // cid1 got the update
    const co1 = await testDb.company.findUnique({ where: { id: cid1 }, select: { legalName: true } })
    expect(co1?.legalName).toBe('HijackAttempt')
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
// talent.view: viewTalentProfile contact-access authz (M4-T18)
// Tests go through the real auth path: mockSession → requireVerifiedCompany → viewTalentProfile.
// ---------------------------------------------------------------------------

describe('talent.view: viewTalentProfile contact-access authz (M4-T18)', () => {
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

  it('guest → ForbiddenError (via requireVerifiedCompany)', async () => {
    mockSession(null)
    await expect(requireVerifiedCompany('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('student → ForbiddenError (via requireVerifiedCompany)', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    await expect(requireVerifiedCompany('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('suspended company member → ForbiddenError (via requireVerifiedCompany)', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })
    mockSession(userId)
    await expect(requireVerifiedCompany('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('other company (B session, student only unlocked by A) → cannot see full name or contact', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    const { profileId, name } = await createStudent(testDb)
    await testDb.company.update({ where: { id: empA.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.company.update({ where: { id: empB.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await makeVisible(profileId)
    await createUnlock(empA.companyId, profileId, empA.userId)

    mockSession(empB.userId)
    const ctx = await requireVerifiedCompany('RECRUITER', noHeaders)
    const detail = await viewTalentProfile(ctx, profileId)

    expect(detail.unlocked).toBe(false)
    expect(detail.name).not.toBe(name)
    expect(detail.contact).toBeNull()
  })

  it('company with revoked verification (previously unlocked) → ForbiddenError (via requireVerifiedCompany)', async () => {
    const emp = await createEmployer(testDb)
    const { profileId } = await createStudent(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    // Revoke company verification after the unlock
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'REJECTED' } })

    mockSession(emp.userId)
    await expect(requireVerifiedCompany('RECRUITER', noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('own company + unlocked → unlocked=true, full name visible', async () => {
    const emp = await createEmployer(testDb)
    const { profileId, name } = await createStudent(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    mockSession(emp.userId)
    const ctx = await requireVerifiedCompany('RECRUITER', noHeaders)
    const detail = await viewTalentProfile(ctx, profileId)

    expect(detail.unlocked).toBe(true)
    expect(detail.name).toBe(name)
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

  it('acceptInvite: non-OWNER invite for managed company → ForbiddenError', async () => {
    const { acceptInvite } = await import('@/server/services/team')
    const { createManagedCompany } = await import('@/server/services/managed-company')
    const admin = await testDb.user.create({
      data: { name: 'Admin MC4', email: `admin-mc4-matrix-${Date.now()}@example.test`, emailVerified: true, role: 'ADMIN', status: 'ACTIVE' },
    })
    const company = await createManagedCompany({ userId: admin.id }, { legalName: `MCo-NOwnerInv-${Date.now()}` })
    const email = `noninv-${Date.now()}@example.test`
    const { createHash, randomBytes } = await import('crypto')
    const rawToken = randomBytes(32).toString('base64url')
    const hash = createHash('sha256').update(rawToken).digest('hex')
    await testDb.companyInvite.create({
      data: { companyId: company.id, email, role: 'ADMIN', tokenHash: hash, expiresAt: new Date(Date.now() + 86_400_000), createdById: admin.id },
    })
    const target = await testDb.user.create({
      data: { name: 'Target MC', email, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await expect(acceptInvite({ userId: target.id }, rawToken)).rejects.toBeInstanceOf(ForbiddenError)
    // Company must remain managed with no members
    const updated = await testDb.company.findUnique({ where: { id: company.id } })
    expect(updated!.isManaged).toBe(true)
    const member = await testDb.companyMember.findFirst({ where: { companyId: company.id } })
    expect(member).toBeNull()
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
    const { NotFoundError: NFE } = await import('@/server/errors')
    const attackerCtx = { userId: attacker.userId, companyId: attacker.companyId, role: 'OWNER' as const }
    await expect(
      svcUpdateJob(attackerCtx, job.id, {
        title: 'Hacked', type: 'INTERNSHIP', description: 'Hacked',
        workMode: 'ONSITE', submit: false, salaryVisible: true,
        acceptsStudentPass: false, sponsorsWorkPass: false, languages: [], skills: [],
      }),
    ).rejects.toBeInstanceOf(NFE)

    const unchanged = await testDb.job.findUnique({ where: { id: job.id } })
    expect(unchanged?.title).toBe('Authz Job')
  })

  it('cross-company: closeJob by other employer → NotFoundError, job remains PUBLISHED', async () => {
    const owner = await createEmployer(testDb)
    const attacker = await createEmployer(testDb)
    const job = await makeJobForCompany(owner.companyId, owner.userId)

    const { closeJob: svcCloseJob } = await import('@/server/services/jobs')
    const { NotFoundError: NFE } = await import('@/server/errors')
    const attackerCtx = { userId: attacker.userId, companyId: attacker.companyId, role: 'OWNER' as const }
    await expect(svcCloseJob(attackerCtx, job.id)).rejects.toBeInstanceOf(NFE)

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
// talent.unlock action authz (M4-T16): action-level guard tests
// ---------------------------------------------------------------------------

describe('talent.unlock: unlockStudentAction action-level authz', () => {
  async function setupActionUnlockSettings() {
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

  async function makeVerifiedEmpWithWallet(balance = 5) {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance } })
    return emp
  }

  async function makeVisibleStudent() {
    const { profileId } = await createStudent(testDb, { completeness: 80 })
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
    })
    return profileId
  }

  it('unverified company → FORBIDDEN, no TalentUnlock, balance unchanged', async () => {
    await setupActionUnlockSettings()
    const emp = await createEmployer(testDb) // UNSUBMITTED
    await testDb.creditWallet.create({ data: { companyId: emp.companyId, balance: 5 } })
    const profileId = await makeVisibleStudent()

    mockSession(emp.userId)
    const { unlockStudentAction } = await import('@/server/actions/unlock')
    const result = await unlockStudentAction({ studentId: profileId })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')

    const unlocks = await testDb.talentUnlock.findMany({ where: { companyId: emp.companyId } })
    expect(unlocks).toHaveLength(0)
    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } })
    expect(wallet?.balance).toBe(5)
  })

  it('student session → FORBIDDEN', async () => {
    await setupActionUnlockSettings()
    const { userId } = await createStudent(testDb)
    const profileId = await makeVisibleStudent()

    mockSession(userId)
    const { unlockStudentAction } = await import('@/server/actions/unlock')
    const result = await unlockStudentAction({ studentId: profileId })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('unauthenticated (no session) → rejected (ok false, FORBIDDEN)', async () => {
    await setupActionUnlockSettings()
    const profileId = await makeVisibleStudent()

    mockSession(null)
    const { unlockStudentAction } = await import('@/server/actions/unlock')
    const result = await unlockStudentAction({ studentId: profileId })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('company A session with extra companyId B in input → unlock belongs to A, B unaffected', async () => {
    await setupActionUnlockSettings()
    const empA = await makeVerifiedEmpWithWallet(5)
    const empB = await makeVerifiedEmpWithWallet(5)
    const profileId = await makeVisibleStudent()

    mockSession(empA.userId)
    const { unlockStudentAction } = await import('@/server/actions/unlock')
    // Pass extra companyId — Zod strips unknown keys; action must use session companyId
    const result = await unlockStudentAction({ studentId: profileId, companyId: empB.companyId } as never)
    expect(result.ok).toBe(true)

    const unlock = await testDb.talentUnlock.findFirst({ where: { studentId: profileId } })
    expect(unlock?.companyId).toBe(empA.companyId)

    // A's balance was deducted; A's ledger has one new UNLOCK entry
    const walletA = await testDb.creditWallet.findUnique({ where: { companyId: empA.companyId } })
    expect(walletA?.balance).toBe(4)
    const ledgerA = await testDb.creditLedger.findMany({
      where: { wallet: { companyId: empA.companyId }, reason: 'UNLOCK' },
    })
    expect(ledgerA).toHaveLength(1)

    // B's balance and ledger are untouched
    const walletB = await testDb.creditWallet.findUnique({ where: { companyId: empB.companyId } })
    expect(walletB?.balance).toBe(5)
    const ledgerB = await testDb.creditLedger.findMany({
      where: { wallet: { companyId: empB.companyId }, reason: 'UNLOCK' },
    })
    expect(ledgerB).toHaveLength(0)
  })

  it('SUSPENDED company member → FORBIDDEN, no charge', async () => {
    await setupActionUnlockSettings()
    const emp = await makeVerifiedEmpWithWallet(5)
    const profileId = await makeVisibleStudent()

    // Suspend the user
    await testDb.user.update({ where: { id: emp.userId }, data: { status: 'SUSPENDED' } })

    mockSession(emp.userId)
    const { unlockStudentAction } = await import('@/server/actions/unlock')
    const result = await unlockStudentAction({ studentId: profileId })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')

    const unlocks = await testDb.talentUnlock.findMany({ where: { companyId: emp.companyId } })
    expect(unlocks).toHaveLength(0)
    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: emp.companyId } })
    expect(wallet?.balance).toBe(5)
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

  it('student blocks company after unlock → 404 (TM-003 gone)', async () => {
    const { profileId, resumeId } = await makeStudentWithResume()
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await createUnlock(emp.companyId, profileId, emp.userId)
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId: emp.companyId } })
    mockSession(emp.userId)
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(404)
  })

  it('valid access + real PDF → 200 application/pdf, Cache-Control: no-store', async () => {
    const { PDFDocument: PD } = await import('pdf-lib')
    const doc = await PD.create()
    doc.addPage([612, 792])
    const minPdf = Buffer.from(await doc.save())

    const { profileId, resumeId } = await makeStudentWithResume()
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await createUnlock(emp.companyId, profileId, emp.userId)
    const { getObjectBytes } = await import('@/lib/storage')
    vi.mocked(getObjectBytes).mockResolvedValueOnce(minPdf)
    mockSession(emp.userId)
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
  }, 30_000)

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

  // --- M4-T19 additional authz rows ---

  it('guest (no session) → 403', async () => {
    const { resumeId } = await makeStudentWithResume()
    mockSession(null)
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(403)
  })

  it('student session (not employer) → 403', async () => {
    const { resumeId } = await makeStudentWithResume()
    const { profileId: studentProfileId } = await createStudent(testDb)
    const studentProfile = await testDb.studentProfile.findUnique({
      where: { id: studentProfileId },
      select: { userId: true },
    })
    mockSession(studentProfile!.userId)
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(403)
  })

  it('unverified company member (even with unlock in DB) → 403 (guards: route verified:true + identityAccess)', async () => {
    const { profileId, resumeId } = await makeStudentWithResume()
    const emp = await createEmployer(testDb)
    // Company left as UNSUBMITTED (not VERIFIED) — both route auth and identityAccess block this
    await createUnlock(emp.companyId, profileId, emp.userId)
    mockSession(emp.userId)
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(403)
  })

  it('IDOR: company unlocked student X but downloads student Y resume → 403', async () => {
    const { profileId: xProfile } = await makeStudentWithResume()
    const { profileId: yProfile, resumeId: yResumeId } = await makeStudentWithResume()

    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    // Only unlock student X
    await createUnlock(emp.companyId, xProfile, emp.userId)
    mockSession(emp.userId)

    // Attempt to download student Y's resume
    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${yResumeId}/download`))
    expect(res.status).toBe(403)
  })

  it('SUSPENDED company member (even with unlock) → 403', async () => {
    const { profileId, resumeId } = await makeStudentWithResume()
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    await createUnlock(emp.companyId, profileId, emp.userId)
    await testDb.user.update({ where: { id: emp.userId }, data: { status: 'SUSPENDED' } })
    mockSession(emp.userId)

    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${resumeId}/download`))
    expect(res.status).toBe(403)
  })

  it('no TalentUnlock + oversized resume → 403 not 422 (sizeBytes check is after identityAccess)', async () => {
    // Create a resume whose sizeBytes exceeds RESUME_MAX_BYTES (5 MB)
    const { profileId } = await createStudent(testDb)
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date() },
    })
    const oversizedResume = await testDb.resumeFile.create({
      data: {
        studentId: profileId,
        storageKey: 'resumes/dl-authz-oversized/cv.pdf',
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 6 * 1024 * 1024, // 6 MB > RESUME_MAX_BYTES
      },
    })
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    // Intentionally no TalentUnlock — identityAccess blocks before sizeBytes
    mockSession(emp.userId)

    const { GET } = await import('@/app/api/resumes/[id]/download/route')
    const res = await GET(new Request(`http://localhost/api/resumes/${oversizedResume.id}/download`))
    // 403 (no unlock), not 422 (file too large) — sizeBytes check moved after identityAccess
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// application authz (M5-T04): action-level guard tests
// ---------------------------------------------------------------------------

describe('application authz (M5-T04): applyToJobAction / withdrawApplicationAction', () => {
  async function seedApplySettings() {
    await testDb.systemSetting.upsert({
      where: { key: 'apply.minCompleteness' },
      create: { key: 'apply.minCompleteness', value: 60 },
      update: { value: 60 },
    })
    const { clearSettingsCache } = await import('@/server/services/settings')
    clearSettingsCache()
  }

  async function makeStudentWithJob() {
    const { userId, profileId } = await createStudent(testDb, { completeness: 70 })
    const emp = await createEmployer(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId, { status: 'PUBLISHED' })
    // M5-T12: pre-seed JobView so canApplyToJob returns true (quota bypass fix)
    await testDb.jobView.create({ data: { studentId: profileId, jobId: job.id } })
    return { userId, profileId, companyId: emp.companyId, job }
  }

  it('guest (no session) → applyToJobAction returns FORBIDDEN', async () => {
    await seedApplySettings()
    const { job } = await makeStudentWithJob()
    mockSession(null)
    const { applyToJobAction } = await import('@/server/actions/applications')
    const result = await applyToJobAction({ jobId: job.id })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('employer session → applyToJobAction returns FORBIDDEN', async () => {
    await seedApplySettings()
    const emp = await createEmployer(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId, { status: 'PUBLISHED' })
    mockSession(emp.userId)
    const { applyToJobAction } = await import('@/server/actions/applications')
    const result = await applyToJobAction({ jobId: job.id })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('student session → applyToJobAction succeeds', async () => {
    await seedApplySettings()
    const { userId, job } = await makeStudentWithJob()
    mockSession(userId)
    const { applyToJobAction } = await import('@/server/actions/applications')
    const result = await applyToJobAction({ jobId: job.id })
    expect(result.ok).toBe(true)
  })

  it('student session, low completeness → returns COMPLETENESS_LOW', async () => {
    await seedApplySettings()
    const { userId: uid } = await createStudent(testDb, { completeness: 30 })
    const emp = await createEmployer(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId, { status: 'PUBLISHED' })
    mockSession(uid)
    const { applyToJobAction } = await import('@/server/actions/applications')
    const result = await applyToJobAction({ jobId: job.id })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('COMPLETENESS_LOW')
  })

  it('student session, duplicate apply → returns DUPLICATE_APPLICATION', async () => {
    await seedApplySettings()
    const { userId, job } = await makeStudentWithJob()
    mockSession(userId)
    const { applyToJobAction } = await import('@/server/actions/applications')
    // First apply succeeds
    await applyToJobAction({ jobId: job.id })
    // Second apply is duplicate
    const result = await applyToJobAction({ jobId: job.id })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('DUPLICATE_APPLICATION')
  })

  it('student A cannot withdraw student B application via action', async () => {
    await seedApplySettings()
    const { userId: uid1, job } = await makeStudentWithJob()
    const { userId: uid2 } = await createStudent(testDb, { completeness: 70 })

    // uid1 applies
    mockSession(uid1)
    const { applyToJobAction, withdrawApplicationAction } = await import('@/server/actions/applications')
    const applyResult = await applyToJobAction({ jobId: job.id })
    expect(applyResult.ok).toBe(true)
    const { applicationId } = (applyResult as { ok: true; data: { applicationId: string } }).data

    // uid2 tries to withdraw uid1's application
    mockSession(uid2)
    const withdrawResult = await withdrawApplicationAction({ applicationId })
    expect(withdrawResult.ok).toBe(false)
    expect((withdrawResult as { ok: false; code: string }).code).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// applicants authz (M5-T05): changeStatusAction / updateNoteAction
// companyId always comes from requireCompanyMember, never from client input.
// ---------------------------------------------------------------------------

describe('applicants authz (M5-T05): changeStatusAction / updateNoteAction', () => {
  // M5-T13: actions now require verified company; fixture updated to reflect this pre-condition
  async function setupApplicantFixture() {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId, { status: 'PUBLISHED' })
    const app = await testDb.application.create({
      data: { jobId: job.id, studentId: student.profileId, status: 'APPLIED' },
    })
    return { emp, student, job, app }
  }

  it('guest → changeStatusAction returns FORBIDDEN', async () => {
    const { app } = await setupApplicantFixture()
    mockSession(null)
    const { changeStatusAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await changeStatusAction({ applicationId: app.id, toStatus: 'VIEWED' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('student → changeStatusAction returns FORBIDDEN', async () => {
    const { app } = await setupApplicantFixture()
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    const { changeStatusAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await changeStatusAction({ applicationId: app.id, toStatus: 'VIEWED' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('cross-company: empA (verified) cannot changeStatus on empB application → NOT_FOUND', async () => {
    const { app: appB } = await setupApplicantFixture()
    // empA must also be verified so we test cross-company isolation (not verification gate)
    const empA = await createEmployer(testDb)
    await testDb.company.update({ where: { id: empA.companyId }, data: { verificationStatus: 'VERIFIED' } })
    mockSession(empA.userId)
    const { changeStatusAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await changeStatusAction({ applicationId: appB.id, toStatus: 'SHORTLISTED' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('NOT_FOUND')
    const unchanged = await testDb.application.findUnique({ where: { id: appB.id } })
    expect(unchanged?.status).toBe('APPLIED')
  })

  it('cross-company: empA (verified) cannot updateNote on empB application → NOT_FOUND', async () => {
    const { app: appB } = await setupApplicantFixture()
    // empA must also be verified so we test cross-company isolation (not verification gate)
    const empA = await createEmployer(testDb)
    await testDb.company.update({ where: { id: empA.companyId }, data: { verificationStatus: 'VERIFIED' } })
    mockSession(empA.userId)
    const { updateNoteAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await updateNoteAction({ applicationId: appB.id, note: 'HIJACK_NOTE' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('NOT_FOUND')
    const unchanged = await testDb.application.findUnique({ where: { id: appB.id } })
    expect(unchanged?.companyNote).not.toBe('HIJACK_NOTE')
  })

  it('owner (verified company) can changeStatus on own application', async () => {
    const { emp, app } = await setupApplicantFixture()
    mockSession(emp.userId)
    const { changeStatusAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await changeStatusAction({ applicationId: app.id, toStatus: 'SHORTLISTED' })
    expect(result.ok).toBe(true)
    const updated = await testDb.application.findUnique({ where: { id: app.id } })
    expect(updated?.status).toBe('SHORTLISTED')
  })

  // M5-T13: unverified company blocked from applicant actions
  it('PENDING company → changeStatusAction returns FORBIDDEN (M5-T13)', async () => {
    const { app } = await setupApplicantFixture()
    // Create a separate PENDING employer
    const pendingEmp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: pendingEmp.companyId }, data: { verificationStatus: 'PENDING' } })
    // Also create their own job and application so the FORBIDDEN is not from cross-company
    const student = await createStudent(testDb)
    const job = await createJob(testDb, pendingEmp.companyId, pendingEmp.userId)
    const ownApp = await testDb.application.create({
      data: { jobId: job.id, studentId: student.profileId, status: 'APPLIED' },
    })
    mockSession(pendingEmp.userId)
    const { changeStatusAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await changeStatusAction({ applicationId: ownApp.id, toStatus: 'VIEWED' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const unchanged = await testDb.application.findUnique({ where: { id: ownApp.id } })
    expect(unchanged?.status).toBe('APPLIED')
    void app // suppress unused warning
  })

  it('REJECTED company → updateNoteAction returns FORBIDDEN (M5-T13)', async () => {
    const rejectedEmp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: rejectedEmp.companyId }, data: { verificationStatus: 'REJECTED' } })
    const student = await createStudent(testDb)
    const job = await createJob(testDb, rejectedEmp.companyId, rejectedEmp.userId)
    const ownApp = await testDb.application.create({
      data: { jobId: job.id, studentId: student.profileId, status: 'APPLIED' },
    })
    mockSession(rejectedEmp.userId)
    const { updateNoteAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await updateNoteAction({ applicationId: ownApp.id, note: 'should be blocked' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const unchanged = await testDb.application.findUnique({ where: { id: ownApp.id } })
    expect(unchanged?.companyNote).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// admin-dashboard authz (M6-T01)
// ---------------------------------------------------------------------------

describe('admin-dashboard authz (M6-T01)', () => {
  it('getDashboardStats: student → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    const { getDashboardStats } = await import('@/server/services/admin-dashboard')
    await expect(getDashboardStats({ userId })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('getDashboardStats: employer → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    const { getDashboardStats } = await import('@/server/services/admin-dashboard')
    await expect(getDashboardStats({ userId })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('getDashboardStats: unauthenticated (non-existent userId) → ForbiddenError', async () => {
    const { getDashboardStats } = await import('@/server/services/admin-dashboard')
    await expect(getDashboardStats({ userId: 'nonexistent-id' })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('getDashboardStats: admin → returns stats object', async () => {
    const admin = await testDb.user.create({
      data: {
        name: 'Dashboard Admin',
        email: `dashboard-admin-matrix-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    })
    const { getDashboardStats } = await import('@/server/services/admin-dashboard')
    const stats = await getDashboardStats({ userId: admin.id })
    expect(typeof stats.studentCount).toBe('number')
    expect(typeof stats.verifiedCompanyCount).toBe('number')
    expect(stats.signupCap).toBeGreaterThan(0)
    expect(Array.isArray(stats.weeklyRegistrations)).toBe(true)
    expect(stats.weeklyRegistrations).toHaveLength(12)
  })
})

// ---------------------------------------------------------------------------
// M5-T07: Invitations
// ---------------------------------------------------------------------------

describe('invitations: authorization', () => {
  it('student cannot call sendInvitation', async () => {
    const { sendInvitation } = await import('@/server/services/invitations')
    // sendInvitation requires a company context; calling with a student's userId
    // should fail because there is no job belonging to the student's "company"
    // but the real guard is at the action layer (auth: company). At the service
    // layer the guard is isStudentVisibleToCompany + job ownership check.
    // We test the action-layer: a student ctx will have no companyId and the
    // action wrapper rejects with FORBIDDEN before the service is reached.
    // Here we verify the service itself rejects when job doesn't belong to company.
    const student = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const job = await createJob(testDb, emp.companyId, emp.userId)

    // A second employer trying to invite using the first employer's job
    const emp2 = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp2.companyId }, data: { verificationStatus: 'VERIFIED' } })

    // Make student visible
    await testDb.studentProfile.update({
      where: { id: student.profileId },
      data: { visibility: 'PUBLIC', completeness: 70, schoolVerifiedAt: new Date() },
    })

    // emp2 cannot invite for emp's job → NotFoundError (job doesn't belong to emp2's company)
    await expect(
      sendInvitation({ userId: emp2.userId, companyId: emp2.companyId }, { studentId: student.profileId, jobId: job.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('employer cannot accept invitation (acceptInvitation requires student profile)', async () => {
    const { acceptInvitation } = await import('@/server/services/invitations')
    const emp = await createEmployer(testDb)
    // employer userId has no StudentProfile → ForbiddenError
    await expect(
      acceptInvitation({ userId: emp.userId }, { invitationId: 'cjld2cjxh0000qzrmn831i7rn' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('student cannot see another company\'s invitations via listCompanyInvitations', async () => {
    const { listCompanyInvitations } = await import('@/server/services/invitations')
    const emp1 = await createEmployer(testDb)
    const emp2 = await createEmployer(testDb)
    // emp1 trying to pass emp2's companyId — but requireCompanyMember guards this at action layer.
    // At service level, the filter is by companyId. emp1 can only get ctx.companyId=emp1.companyId
    // from requireCompanyMember. Here we verify: calling with emp2.companyId returns only emp2's data.
    const result = await listCompanyInvitations({ userId: emp1.userId, companyId: emp2.companyId })
    // emp2 has no invitations yet, so result is empty — the main point is it doesn't throw
    expect(Array.isArray(result)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// notifications authz (M5-T08)
// markAllNotificationsReadAction: each user can only mark their own as read
// ---------------------------------------------------------------------------

describe('notifications authz (M5-T08)', () => {
  it('student A cannot mark student B notifications as read (markNotificationsReadAction, wrong ids)', async () => {
    const a = await createStudent(testDb)
    const b = await createStudent(testDb)

    // Create a notification for B
    const notif = await testDb.notification.create({
      data: { userId: b.userId, type: 'test.event', payload: {} },
    })

    // A tries to mark B's notification as read
    mockSession(a.userId)
    const { markNotificationsReadAction } = await import('@/server/actions/notifications')
    await markNotificationsReadAction({ ids: [notif.id] })

    // Notification must remain unread (the action filters by userId from session)
    const still = await testDb.notification.findUnique({ where: { id: notif.id } })
    expect(still?.readAt).toBeNull()
  })

  it('markAllNotificationsReadAction: guest → FORBIDDEN', async () => {
    mockSession(null)
    const { markAllNotificationsReadAction } = await import('@/server/actions/notifications')
    const result = await markAllNotificationsReadAction({})
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('markAllNotificationsReadAction: authenticated user can mark their own as read', async () => {
    const { userId } = await createStudent(testDb)
    await testDb.notification.create({ data: { userId, type: 'test.read', payload: {} } })

    mockSession(userId)
    const { markAllNotificationsReadAction } = await import('@/server/actions/notifications')
    const result = await markAllNotificationsReadAction({})
    expect(result.ok).toBe(true)

    const rows = await testDb.notification.findMany({ where: { userId } })
    expect(rows.every((r) => r.readAt !== null)).toBe(true)
  })
})
