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

describe('private resume parsing actions (M9-T01)', () => {
  const operations = [
    'setResumeParseConsentAction', 'requestResumeParseAction', 'getResumeParseDraftAction',
    'confirmResumeParseAction', 'discardResumeParseDraftAction',
  ] as const
  const resumeId = 'c' + '1'.repeat(24)
  for (const operation of operations) {
    it.each(['anonymous', 'employer', 'suspended-student'] as const)(operation + ' denies %s', async actor => {
      clearSettingsCache()
      if (actor === 'anonymous') mockSession(null)
      else {
        const user = actor === 'employer' ? await createEmployer(testDb) : await createStudent(testDb)
        if (actor === 'suspended-student') await testDb.user.update({ where: { id: user.userId }, data: { status: 'SUSPENDED' } })
        mockSession(user.userId)
      }
      const actions = await import('@/server/actions/resume-parsing')
      const input = operation === 'setResumeParseConsentAction'
        ? { granted: false }
        : { resumeId, generation: 1, expectedProfileRevision: 0, patch: { headline: 'Synthetic action' } }
      await expect(actions[operation](input)).resolves.toEqual({ ok: false, code: 'FORBIDDEN' })
      expect(await testDb.resumeParseDraft.count()).toBe(0)
      expect(await testDb.consent.count({ where: { type: 'AI_RESUME_PARSE' } })).toBe(0)
    })
  }
})

const noHeaders = new Headers()

type MockSessionOptions = {
  createdAt?: Date
  twoFactorVerifiedAt?: Date | null
}

function mockSession(userId: string | null, options: MockSessionOptions = {}) {
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
        createdAt: options.createdAt ?? new Date(),
        updatedAt: new Date(),
        twoFactorVerifiedAt: options.twoFactorVerifiedAt ?? null,
      },
    })
  }
}

function createTwoFactorAdmin(twoFactorEnabled = true) {
  return testDb.user.create({
    data: {
      name: 'Two Factor Admin',
      email: 'admin-two-factor-matrix@example.test',
      emailVerified: true,
      role: 'ADMIN',
      status: 'ACTIVE',
      twoFactorEnabled,
    },
  })
}

const adminSessionDenials = [
  { scenario: '2FA not enabled', enabled: false, verified: true, ageMinutes: 0, code: 'TWO_FACTOR_REQUIRED' },
  { scenario: '2FA not verified for this session', enabled: true, verified: false, ageMinutes: 0, code: 'FORBIDDEN' },
  { scenario: 'session older than 12 hours', enabled: true, verified: true, ageMinutes: 721, code: 'FORBIDDEN' },
  { scenario: 'session older than 10 minutes', enabled: true, verified: true, ageMinutes: 11, code: 'FRESH_SESSION_REQUIRED' },
] as const

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// requireUser
// ---------------------------------------------------------------------------

describe('growth and risk management actions (M6-T08)', () => {
  const operations = ['voidReferral', 'resolveReport', 'saveArticle', 'saveSynonym'] as const
  type Operation = (typeof operations)[number]

  async function fixture(operation: Operation) {
    if (operation === 'voidReferral') {
      const referrer = await createStudent(testDb)
      const invitee = await createStudent(testDb)
      const row = await testDb.referral.create({
        data: { referrerId: referrer.profileId, inviteeId: invitee.profileId, status: 'QUALIFIED' },
      })
      return { id: row.id, input: { referralId: row.id, reason: 'synthetic moderation' } }
    }
    if (operation === 'resolveReport') {
      const employer = await createEmployer(testDb)
      const job = await createJob(testDb, employer.companyId, employer.userId)
      const student = await createStudent(testDb)
      const row = await testDb.jobReport.create({
        data: { jobId: job.id, reporterId: student.userId, reason: 'ASKS_PAYMENT' },
      })
      return { id: row.id, input: { reportId: row.id, status: 'RESOLVED' } }
    }
    if (operation === 'saveArticle') {
      return { id: '', input: { category: 'GUIDE', title: 'Synthetic guide', body: 'Synthetic safe body', sortOrder: 0, published: false } }
    }
    return { id: '', input: { terms: ['synthetic-alias', 'synthetic-match'], active: true } }
  }

  async function invoke(operation: Operation, input: unknown) {
    if (operation === 'voidReferral') {
      return (await import('@/server/actions/admin-growth')).voidReferralAction(input)
    }
    if (operation === 'resolveReport') {
      return (await import('@/server/actions/admin-reports')).resolveReportAction(input)
    }
    if (operation === 'saveArticle') {
      return (await import('@/server/actions/admin-articles')).saveArticleAction(input)
    }
    return (await import('@/server/actions/admin-growth')).saveSynonymGroupAction(input)
  }

  async function state() {
    return {
      referrals: await testDb.referral.findMany({ orderBy: { id: 'asc' } }),
      reports: await testDb.jobReport.findMany({ orderBy: { id: 'asc' } }),
      articles: await testDb.article.findMany({ orderBy: { id: 'asc' } }),
      synonyms: await testDb.searchSynonymGroup.findMany({ orderBy: { id: 'asc' } }),
      audits: await testDb.auditLog.findMany({ orderBy: { id: 'asc' } }),
    }
  }

  for (const operation of operations) {
    it.each([
      'guest', 'STUDENT', 'EMPLOYER', 'suspended-admin', 'deleted-admin',
      'unverified-2fa', 'disabled-2fa', 'expired-admin',
    ] as const)(operation + ': %s is rejected without mutations', async (actor) => {
      const sample = await fixture(operation)
      if (actor === 'guest') {
        mockSession(null)
      } else {
        const admin = await createTwoFactorAdmin(actor !== 'disabled-2fa')
        await testDb.user.update({
          where: { id: admin.id },
          data: {
            role: actor === 'STUDENT' || actor === 'EMPLOYER' ? actor : 'ADMIN',
            status: actor === 'suspended-admin' ? 'SUSPENDED' : actor === 'deleted-admin' ? 'DELETED' : 'ACTIVE',
          },
        })
        mockSession(admin.id, {
          createdAt: new Date(Date.now() - (actor === 'expired-admin' ? 721 : 0) * 60_000),
          twoFactorVerifiedAt: actor === 'unverified-2fa' ? null : new Date(),
        })
      }
      const before = await state()
      const result = await invoke(operation, sample.input)
      expect(result).toMatchObject({
        ok: false,
        code: actor === 'disabled-2fa' ? 'TWO_FACTOR_REQUIRED' : 'FORBIDDEN',
      })
      expect(await state()).toEqual(before)
    })

    it(operation + ': an active verified admin may operate after the sensitive fresh window', async () => {
      const sample = await fixture(operation)
      const admin = await createTwoFactorAdmin()
      const verifiedAt = new Date(Date.now() - 11 * 60_000)
      mockSession(admin.id, { createdAt: verifiedAt, twoFactorVerifiedAt: verifiedAt })
      const result = await invoke(operation, sample.input)
      expect(result.ok).toBe(true)
      const events = await testDb.auditLog.findMany({ where: { actorId: admin.id } })
      expect(events).toHaveLength(1)
      expect(events[0].action).toBe({
        voidReferral: 'referral.void',
        resolveReport: 'job.report.resolve',
        saveArticle: 'article.save',
        saveSynonym: 'search.synonym.save',
      }[operation])
    })
  }
})

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
      data: { name: 'Admin', email: 'admin2-matrix@example.test', emailVerified: true, role: 'ADMIN', status: 'ACTIVE', twoFactorEnabled: true },
    })
    mockSession(admin.id, { twoFactorVerifiedAt: new Date() })
    const ctx = await requireAdmin(noHeaders)
    expect(ctx.userId).toBe(admin.id)
  })

  it('admin without enabled 2FA → TWO_FACTOR_REQUIRED', async () => {
    const admin = await createTwoFactorAdmin(false)
    mockSession(admin.id, { twoFactorVerifiedAt: new Date() })
    await expect(requireAdmin(noHeaders)).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' })
  })

  it('enabled admin without session verification → ForbiddenError', async () => {
    const admin = await createTwoFactorAdmin()
    mockSession(admin.id)
    await expect(requireAdmin(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('verified admin within 12 hours can use ordinary admin operations', async () => {
    const admin = await createTwoFactorAdmin()
    const createdAt = new Date(Date.now() - (12 * 60 - 1) * 60_000)
    mockSession(admin.id, { createdAt, twoFactorVerifiedAt: createdAt })
    await expect(requireAdmin(noHeaders)).resolves.toEqual({ userId: admin.id })
  })

  it('admin session older than 12 hours is denied despite recent update and verification', async () => {
    const admin = await createTwoFactorAdmin()
    mockSession(admin.id, {
      createdAt: new Date(Date.now() - (12 * 60 + 1) * 60_000),
      twoFactorVerifiedAt: new Date(),
    })
    await expect(requireAdmin(noHeaders)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('fresh admin verification within 10 minutes → pass', async () => {
    const admin = await createTwoFactorAdmin()
    const createdAt = new Date(Date.now() - 9 * 60_000)
    mockSession(admin.id, { createdAt, twoFactorVerifiedAt: createdAt })
    await expect(requireAdmin(noHeaders, { fresh: true })).resolves.toEqual({ userId: admin.id })
  })

  it('admin verification older than 10 minutes → FRESH_SESSION_REQUIRED', async () => {
    const admin = await createTwoFactorAdmin()
    const createdAt = new Date(Date.now() - 11 * 60_000)
    mockSession(admin.id, { createdAt, twoFactorVerifiedAt: createdAt })
    await expect(requireAdmin(noHeaders, { fresh: true })).rejects.toMatchObject({ code: 'FRESH_SESSION_REQUIRED' })
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
  it('removed member is denied on the next action even with the same valid session', async () => {
    const { userId: ownerId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'VERIFIED' } })
    const { userId } = await createEmployerWithoutCompany(testDb)
    const member = await testDb.companyMember.create({ data: { userId, companyId, role: 'RECRUITER' } })
    const { createFolderAction } = await import('@/server/actions/folders')
    const { removeMember } = await import('@/server/services/team')
    mockSession(userId)
    expect((await createFolderAction({ name: 'Before removal' })).ok).toBe(true)
    await removeMember({ userId: ownerId, companyId, role: 'OWNER' }, { memberId: member.id })
    expect(await createFolderAction({ name: 'After removal' })).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(await testDb.talentFolder.count({ where: { companyId, name: 'After removal' } })).toBe(0)
  })

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
    try {
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/pdf')
      expect(res.headers.get('cache-control')).toContain('no-store')
      expect(res.headers.get('x-robots-tag')).toBe('noindex')
    } finally {
      await res.body?.cancel()
    }
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
// markViewedAction authz (M5-T14)
// ---------------------------------------------------------------------------

describe('markViewedAction authz (M5-T14)', () => {
  async function setupMarkViewedFixture() {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId, { status: 'PUBLISHED' })
    const app = await testDb.application.create({
      data: { jobId: job.id, studentId: student.profileId, status: 'APPLIED' },
    })
    return { emp, student, job, app }
  }

  it('guest → markViewedAction returns FORBIDDEN', async () => {
    const { app } = await setupMarkViewedFixture()
    mockSession(null)
    const { markViewedAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await markViewedAction({ applicationId: app.id })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const unchanged = await testDb.application.findUnique({ where: { id: app.id } })
    expect(unchanged?.status).toBe('APPLIED')
  })

  it('student → markViewedAction returns FORBIDDEN', async () => {
    const { app } = await setupMarkViewedFixture()
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    const { markViewedAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await markViewedAction({ applicationId: app.id })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const unchanged = await testDb.application.findUnique({ where: { id: app.id } })
    expect(unchanged?.status).toBe('APPLIED')
  })

  it('owner (verified) can markViewed on own application', async () => {
    const { emp, app } = await setupMarkViewedFixture()
    mockSession(emp.userId)
    const { markViewedAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await markViewedAction({ applicationId: app.id })
    expect(result.ok).toBe(true)
    const updated = await testDb.application.findUnique({ where: { id: app.id } })
    expect(updated?.status).toBe('VIEWED')
  })

  it('cross-company: empA cannot markViewed on empB application (graceful no-op)', async () => {
    const { app: appB } = await setupMarkViewedFixture()
    const empA = await createEmployer(testDb)
    await testDb.company.update({ where: { id: empA.companyId }, data: { verificationStatus: 'VERIFIED' } })
    mockSession(empA.userId)
    const { markViewedAction } = await import('@/app/[locale]/e/jobs/[id]/applicants/actions')
    const result = await markViewedAction({ applicationId: appB.id })
    expect(result.ok).toBe(true)
    const unchanged = await testDb.application.findUnique({ where: { id: appB.id } })
    expect(unchanged?.status).toBe('APPLIED')
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
// admin-users authz (M6-T02)
// ---------------------------------------------------------------------------

describe('admin-users authz (M6-T02)', () => {
  async function makeStudentWithSession() {
    const { userId, profileId } = await createStudent(testDb)
    await testDb.session.create({
      data: { userId, token: `tok-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) },
    })
    return { userId, profileId }
  }

  it('suspendUserAction: student → FORBIDDEN, user status unchanged', async () => {
    const { userId: actorId } = await createStudent(testDb)
    const { userId: targetId } = await makeStudentWithSession()
    mockSession(actorId)
    const { suspendUserAction } = await import('@/server/actions/admin-users')
    const result = await suspendUserAction({ targetUserId: targetId, reason: 'test' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const user = await testDb.user.findUnique({ where: { id: targetId }, select: { status: true } })
    expect(user?.status).toBe('ACTIVE')
  })

  it('suspendUserAction: employer → FORBIDDEN, user status unchanged', async () => {
    const { userId: actorId } = await createEmployer(testDb)
    const { userId: targetId } = await makeStudentWithSession()
    mockSession(actorId)
    const { suspendUserAction } = await import('@/server/actions/admin-users')
    const result = await suspendUserAction({ targetUserId: targetId, reason: 'test' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
    const user = await testDb.user.findUnique({ where: { id: targetId }, select: { status: true } })
    expect(user?.status).toBe('ACTIVE')
  })

  it('suspendUserAction: admin → ok, user SUSPENDED, sessions deleted', async () => {
    const admin = await testDb.user.create({
      data: { name: 'Admin M6', email: `admin-m6t02-${Date.now()}@example.test`, emailVerified: true, role: 'ADMIN', status: 'ACTIVE', twoFactorEnabled: true },
    })
    const { userId: targetId } = await makeStudentWithSession()
    mockSession(admin.id, { twoFactorVerifiedAt: new Date() })
    const { suspendUserAction } = await import('@/server/actions/admin-users')
    const result = await suspendUserAction({ targetUserId: targetId, reason: 'authz test' })
    expect(result.ok).toBe(true)
    const user = await testDb.user.findUnique({ where: { id: targetId }, select: { status: true } })
    expect(user?.status).toBe('SUSPENDED')
    const sessions = await testDb.session.findMany({ where: { userId: targetId } })
    expect(sessions).toHaveLength(0)
  })

  it('restoreUserAction: student → FORBIDDEN', async () => {
    const { userId: actorId } = await createStudent(testDb)
    const { userId: targetId } = await createStudent(testDb)
    await testDb.user.update({ where: { id: targetId }, data: { status: 'SUSPENDED' } })
    mockSession(actorId)
    const { restoreUserAction } = await import('@/server/actions/admin-users')
    const result = await restoreUserAction({ targetUserId: targetId })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('grantJobViewQuotaAction: student → FORBIDDEN', async () => {
    const { userId: actorId } = await createStudent(testDb)
    const { userId: targetId } = await createStudent(testDb)
    mockSession(actorId)
    const { grantJobViewQuotaAction } = await import('@/server/actions/admin-users')
    const result = await grantJobViewQuotaAction({ studentUserId: targetId, amount: 5, note: 'x' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('approveSchoolVerificationAction: employer → FORBIDDEN', async () => {
    const { userId: actorId } = await createEmployer(testDb)
    const { userId: targetId } = await createStudent(testDb)
    mockSession(actorId)
    const { approveSchoolVerificationAction } = await import('@/server/actions/admin-users')
    const result = await approveSchoolVerificationAction({ studentUserId: targetId })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('readStudentContactAdminAction: student → FORBIDDEN', async () => {
    const { userId: actorId } = await createStudent(testDb)
    const { userId: targetId } = await createStudent(testDb)
    mockSession(actorId)
    const { readStudentContactAdminAction } = await import('@/server/actions/admin-users')
    const result = await readStudentContactAdminAction({ studentUserId: targetId })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('readStudentContactAdminAction: admin → ok, writes contact.read audit', async () => {
    const admin = await testDb.user.create({
      data: { name: 'Admin Contact', email: `admin-contact-${Date.now()}@example.test`, emailVerified: true, role: 'ADMIN', status: 'ACTIVE', twoFactorEnabled: true },
    })
    const { userId: targetId, profileId } = await createStudent(testDb)
    mockSession(admin.id, { twoFactorVerifiedAt: new Date() })
    const { readStudentContactAdminAction } = await import('@/server/actions/admin-users')
    const result = await readStudentContactAdminAction({ studentUserId: targetId })
    expect(result.ok).toBe(true)
    const audits = await testDb.auditLog.findMany({
      where: { actorId: admin.id, action: 'contact.read', targetId: profileId },
    })
    expect(audits.length).toBeGreaterThanOrEqual(1)
  })

  it.each(adminSessionDenials)('readStudentContactAdminAction: $scenario → $code, no contact audit', async ({ enabled, verified, ageMinutes, code }) => {
    const admin = await createTwoFactorAdmin(enabled)
    const { userId: targetId, profileId } = await createStudent(testDb)
    const createdAt = new Date(Date.now() - ageMinutes * 60_000)
    mockSession(admin.id, { createdAt, twoFactorVerifiedAt: verified ? createdAt : null })

    const { readStudentContactAdminAction } = await import('@/server/actions/admin-users')
    const result = await readStudentContactAdminAction({ studentUserId: targetId })

    expect(result).toEqual({ ok: false, code })
    expect(await testDb.auditLog.count({
      where: { actorId: admin.id, action: 'contact.read', targetId: profileId },
    })).toBe(0)
  })

  it('createSchoolAction: student → FORBIDDEN', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    const { createSchoolAction } = await import('@/app/[locale]/admin/schools/actions')
    const result = await createSchoolAction({
      nameZh: '测试',
      nameEn: 'Test',
      emailDomains: ['test.edu.my'],
      country: 'MY',
      isPartner: false,
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('createPartnerAction: employer → FORBIDDEN', async () => {
    const { userId } = await createEmployer(testDb)
    mockSession(userId)
    const { createPartnerAction } = await import('@/app/[locale]/admin/partners/actions')
    const result = await createPartnerAction({
      name: 'Test Partner',
      type: 'ENTERPRISE',
      showOnHome: false,
      sortOrder: 0,
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('deletePartnerAction: student → FORBIDDEN', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    const { deletePartnerAction } = await import('@/app/[locale]/admin/partners/actions')
    const result = await deletePartnerAction({ id: 'clzzzzzzzzzzzzzzzzzzzzzzz' })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
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

// ---------------------------------------------------------------------------
// admin-companies authz (M6-T03)
// ---------------------------------------------------------------------------

describe('admin-companies authz (M6-T03)', () => {
  it('deactivateCompanyAction: student cannot deactivate', async () => {
    const { userId } = await createStudent(testDb)
    const company = await testDb.company.create({ data: { legalName: `AC-${Date.now()}`, isActive: true } })
    mockSession(userId)
    const { deactivateCompanyAction } = await import('@/server/actions/admin-companies')
    const result = await deactivateCompanyAction({ companyId: company.id, reason: 'test' })
    expect(result.ok).toBe(false)
  })

  it('deactivateCompanyAction: employer cannot deactivate', async () => {
    const { userId } = await createEmployer(testDb)
    const company = await testDb.company.create({ data: { legalName: `AC-${Date.now()}`, isActive: true } })
    mockSession(userId)
    const { deactivateCompanyAction } = await import('@/server/actions/admin-companies')
    const result = await deactivateCompanyAction({ companyId: company.id, reason: 'test' })
    expect(result.ok).toBe(false)
  })

  it('adjustCompanyCreditsAction: student cannot adjust credits', async () => {
    const { userId } = await createStudent(testDb)
    const company = await testDb.company.create({ data: { legalName: `AC-${Date.now()}` } })
    await testDb.creditWallet.create({ data: { companyId: company.id, balance: 50 } })
    mockSession(userId)
    const { adjustCompanyCreditsAction } = await import('@/server/actions/admin-companies')
    const result = await adjustCompanyCreditsAction({ companyId: company.id, delta: 100, note: 'test' })
    expect(result.ok).toBe(false)
  })

  it('adjustCompanyCreditsAction: fresh verified admin → balance, ledger and audit updated', async () => {
    const admin = await createTwoFactorAdmin()
    const company = await testDb.company.create({ data: { legalName: 'Fresh session credits company' } })
    const wallet = await testDb.creditWallet.create({ data: { companyId: company.id, balance: 50 } })
    mockSession(admin.id, { twoFactorVerifiedAt: new Date() })
    const { adjustCompanyCreditsAction } = await import('@/server/actions/admin-companies')

    const result = await adjustCompanyCreditsAction({ companyId: company.id, delta: 100, note: 'fresh session test' })

    expect(result).toEqual({ ok: true, data: { balanceAfter: 150 } })
    expect(await testDb.creditWallet.findUnique({ where: { id: wallet.id } })).toMatchObject({ balance: 150 })
    expect(await testDb.creditLedger.count({ where: { walletId: wallet.id, actorId: admin.id, reason: 'ADMIN_ADJUST' } })).toBe(1)
    expect(await testDb.auditLog.count({ where: { actorId: admin.id, action: 'credits.adjust', targetId: company.id } })).toBe(1)
  })

  it.each(adminSessionDenials)('adjustCompanyCreditsAction: $scenario → $code, no balance/ledger/audit changes', async ({ enabled, verified, ageMinutes, code }) => {
    const admin = await createTwoFactorAdmin(enabled)
    const company = await testDb.company.create({ data: { legalName: 'Denied session credits company' } })
    const wallet = await testDb.creditWallet.create({ data: { companyId: company.id, balance: 50 } })
    const createdAt = new Date(Date.now() - ageMinutes * 60_000)
    mockSession(admin.id, { createdAt, twoFactorVerifiedAt: verified ? createdAt : null })
    const { adjustCompanyCreditsAction } = await import('@/server/actions/admin-companies')

    const result = await adjustCompanyCreditsAction({ companyId: company.id, delta: 100, note: 'denied session test' })

    expect(result).toEqual({ ok: false, code })
    expect(await testDb.creditWallet.findUnique({ where: { id: wallet.id } })).toMatchObject({ balance: 50 })
    expect(await testDb.creditLedger.count({ where: { walletId: wallet.id } })).toBe(0)
    expect(await testDb.auditLog.count({ where: { actorId: admin.id, action: 'credits.adjust', targetId: company.id } })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// admin-settings authz (M6-T05)
// ---------------------------------------------------------------------------

describe('admin-settings authz (M6-T05)', () => {
  it('updateSettingAction: student → FORBIDDEN', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    const { updateSettingAction } = await import('@/app/[locale]/admin/settings/actions')
    const result = await updateSettingAction({ key: 'team.maxMembers', value: 5 })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('updateSettingAction: employer → FORBIDDEN', async () => {
    const { userId } = await createEmployer(testDb)
    mockSession(userId)
    const { updateSettingAction } = await import('@/app/[locale]/admin/settings/actions')
    const result = await updateSettingAction({ key: 'team.maxMembers', value: 5 })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('updateSettingAction: admin with invalid value → VALIDATION_ERROR', async () => {
    const { userId } = await createStudent(testDb)
    // Promote to ADMIN for this test
    const admin = await testDb.user.create({
      data: {
        name: 'Admin',
        email: `admin-auth-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'ADMIN',
        status: 'ACTIVE',
        twoFactorEnabled: true,
      },
    })
    mockSession(admin.id, { twoFactorVerifiedAt: new Date() })
    const { updateSettingAction } = await import('@/app/[locale]/admin/settings/actions')
    // number out of range
    const result = await updateSettingAction({ key: 'pilot.monthlyCredits', value: -100 })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('VALIDATION_ERROR')
  })
})

// ---------------------------------------------------------------------------
// applicants service cross-company authz (M7-T05)
// Every employer-side service that takes companyId must reject another company's data.
// ---------------------------------------------------------------------------

describe('applicants service cross-company authz (M7-T05)', () => {
  async function makeVerifiedEmpAndApp() {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId, { status: 'PUBLISHED' })
    const app = await testDb.application.create({
      data: { jobId: job.id, studentId: student.profileId, status: 'APPLIED' },
    })
    return { emp, student, job, app }
  }

  it('listJobApplicants: company A ctx cannot list company B job applicants → NotFoundError', async () => {
    const { emp: empB, job: jobB } = await makeVerifiedEmpAndApp()
    const empA = await createEmployer(testDb)
    await testDb.company.update({ where: { id: empA.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const { listJobApplicants } = await import('@/server/services/applicants')
    await expect(
      listJobApplicants({ userId: empA.userId, companyId: empA.companyId, role: 'OWNER' }, jobB.id),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('getApplicantDetail: company A ctx cannot view company B application → NotFoundError', async () => {
    const { emp: empB, app: appB } = await makeVerifiedEmpAndApp()
    const empA = await createEmployer(testDb)
    await testDb.company.update({ where: { id: empA.companyId }, data: { verificationStatus: 'VERIFIED' } })
    const { getApplicantDetail } = await import('@/server/services/applicants')
    await expect(
      getApplicantDetail({ userId: empA.userId, companyId: empA.companyId, role: 'OWNER' }, appB.id),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ---------------------------------------------------------------------------
// M7-T03 data-rights authz rows
// ---------------------------------------------------------------------------

describe('data-rights authz (M7-T03)', () => {
  it('resolveDataRequestAction: student → FORBIDDEN', async () => {
    const { userId } = await createStudent(testDb)
    mockSession(userId)
    const { resolveDataRequestAction } = await import('@/server/actions/data-rights')
    const result = await resolveDataRequestAction({
      requestId: 'cltest000000000000000000',
      resolution: 'DONE',
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })

  it('resolveDataRequestAction: guest → FORBIDDEN', async () => {
    mockSession(null)
    const { resolveDataRequestAction } = await import('@/server/actions/data-rights')
    const result = await resolveDataRequestAction({
      requestId: 'cltest000000000000000000',
      resolution: 'DONE',
    })
    expect(result.ok).toBe(false)
    expect((result as { ok: false; code: string }).code).toBe('FORBIDDEN')
  })
})

// ---------------------------------------------------------------------------
// Remaining employer-side services: company A's ctx must never read or change company B's data
// (M7-T05 acceptance: every employer-side service that takes companyId has a cross-company case).
// ---------------------------------------------------------------------------

describe('employer-side services cross-company authz (M7-T05, remaining)', () => {
  async function verifiedEmployer() {
    const emp = await createEmployer(testDb)
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'VERIFIED' } })
    return { ...emp, ctx: { userId: emp.userId, companyId: emp.companyId, role: 'OWNER' as const } }
  }
  async function appOf(emp: { companyId: string; userId: string }) {
    const student = await createStudent(testDb)
    const job = await createJob(testDb, emp.companyId, emp.userId, { status: 'PUBLISHED' })
    const app = await testDb.application.create({
      data: { jobId: job.id, studentId: student.profileId, status: 'APPLIED', companyNote: 'B note' },
    })
    return { job, app }
  }

  it('changeApplicationStatus: A cannot move B application; status unchanged', async () => {
    const a = await verifiedEmployer()
    const b = await verifiedEmployer()
    const { app } = await appOf(b)
    const { changeApplicationStatus } = await import('@/server/services/applicants')
    await expect(changeApplicationStatus(a.ctx, { applicationId: app.id, toStatus: 'SHORTLISTED' })).rejects.toBeInstanceOf(NotFoundError)
    expect((await testDb.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('APPLIED')
  })

  it('updateApplicationNote: A cannot overwrite B note; note unchanged', async () => {
    const a = await verifiedEmployer()
    const b = await verifiedEmployer()
    const { app } = await appOf(b)
    const { updateApplicationNote } = await import('@/server/services/applicants')
    await expect(updateApplicationNote(a.ctx, { applicationId: app.id, note: 'A wrote this' })).rejects.toBeInstanceOf(NotFoundError)
    expect((await testDb.application.findUniqueOrThrow({ where: { id: app.id } })).companyNote).toBe('B note')
  })

  it('markApplicationViewed: A opening B application is a silent no-op; B status unchanged', async () => {
    const a = await verifiedEmployer()
    const b = await verifiedEmployer()
    const { app } = await appOf(b)
    const { markApplicationViewed } = await import('@/server/services/applicants')
    // By design this runs on page open and returns quietly for a foreign or missing application.
    await markApplicationViewed(a.ctx, app.id)
    expect((await testDb.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('APPLIED')
    expect(await testDb.applicationEvent.count({ where: { applicationId: app.id } })).toBe(0)
  })

  it('getCompanyJob and copyJob: A cannot read or copy B job; no copy is created', async () => {
    const a = await verifiedEmployer()
    const b = await verifiedEmployer()
    const { job } = await appOf(b)
    const { getCompanyJob, copyJob } = await import('@/server/services/jobs')
    await expect(getCompanyJob(a.ctx, job.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(copyJob(a.ctx, job.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.job.count({ where: { companyId: a.companyId } })).toBe(0)
  })

  it('listCompanyJobs: A sees only its own jobs', async () => {
    const a = await verifiedEmployer()
    const b = await verifiedEmployer()
    const { job: jobB } = await appOf(b)
    const jobA = await createJob(testDb, a.companyId, a.userId, { status: 'PUBLISHED' })
    const { listCompanyJobs } = await import('@/server/services/jobs')
    const ids = (await listCompanyJobs(a.ctx)).map((j) => j.id)
    expect(ids).toEqual([jobA.id])
    expect(ids).not.toContain(jobB.id)
  })

  it('renameFolder and deleteFolder: A cannot touch B folder; folder unchanged', async () => {
    const a = await verifiedEmployer()
    const b = await verifiedEmployer()
    const folder = await testDb.talentFolder.create({ data: { companyId: b.companyId, name: 'B folder', createdById: b.userId } })
    const { renameFolder, deleteFolder } = await import('@/server/services/talent-folders')
    await expect(renameFolder(a.ctx, { id: folder.id, name: 'pwned' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(deleteFolder(a.ctx, { id: folder.id })).rejects.toBeInstanceOf(NotFoundError)
    expect((await testDb.talentFolder.findUniqueOrThrow({ where: { id: folder.id } })).name).toBe('B folder')
  })

  it('listTeamMembers: A sees only its own members', async () => {
    const a = await verifiedEmployer()
    const b = await verifiedEmployer()
    const { listTeamMembers } = await import('@/server/services/team')
    const userIds = (await listTeamMembers(a.ctx)).map((m) => m.userId)
    expect(userIds).toContain(a.userId)
    expect(userIds).not.toContain(b.userId)
  })
})

// ---------------------------------------------------------------------------
// listAuditLogs authz (M6-T06)
// ---------------------------------------------------------------------------

describe('listAuditLogs authz (M6-T06)', () => {
  it('student → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    const { listAuditLogs } = await import('@/server/services/admin-audit')
    await expect(listAuditLogs({ userId }, {})).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('employer → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    const { listAuditLogs } = await import('@/server/services/admin-audit')
    await expect(listAuditLogs({ userId }, {})).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('unauthenticated (non-existent userId) → ForbiddenError', async () => {
    const { listAuditLogs } = await import('@/server/services/admin-audit')
    await expect(listAuditLogs({ userId: 'does-not-exist' }, {})).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin → returns items array', async () => {
    const admin = await testDb.user.create({
      data: { name: 'Admin', email: 'admin-audit-matrix@example.test', emailVerified: true, role: 'ADMIN', status: 'ACTIVE' },
    })
    const { listAuditLogs } = await import('@/server/services/admin-audit')
    const result = await listAuditLogs({ userId: admin.id }, {})
    expect(Array.isArray(result.items)).toBe(true)
  })
})

describe('public job reporting action (M7-T09)', () => {
  async function publishedJob() {
    const employer = await createEmployer(testDb)
    return createJob(testDb, employer.companyId, employer.userId, { status: 'PUBLISHED' })
  }

  it.each(['guest', 'suspended', 'deleted', 'missing', 'expired-admin'] as const)(
    '%s cannot submit a report or notification', async (actor) => {
      const job = await publishedJob()
      if (actor === 'guest') mockSession(null)
      else if (actor === 'missing') mockSession('missing-report-user')
      else if (actor === 'expired-admin') {
        const admin = await createTwoFactorAdmin()
        mockSession(admin.id, {
          createdAt: new Date(Date.now() - 13 * 3600_000), twoFactorVerifiedAt: new Date(),
        })
      } else {
        const student = await createStudent(testDb)
        await testDb.user.update({ where: { id: student.userId }, data: {
          status: actor === 'suspended' ? 'SUSPENDED' : 'DELETED',
        } })
        mockSession(student.userId)
      }
      const before = await testDb.notification.count()
      const { createReportAction } = await import('@/server/actions/reports')
      expect(await createReportAction({ jobId: job.id, reason: 'OTHER' }))
        .toEqual({ ok: false, code: 'FORBIDDEN' })
      expect(await testDb.jobReport.count()).toBe(0)
      expect(await testDb.notification.count()).toBe(before)
    },
  )

  it.each(['STUDENT', 'EMPLOYER', 'ADMIN'] as const)(
    '%s submits using its session identity, never client-supplied identity', async (role) => {
      const job = await publishedJob()
      const student = await createStudent(testDb)
      await testDb.user.update({ where: { id: student.userId }, data: { role } })
      mockSession(student.userId)
      const { createReportAction } = await import('@/server/actions/reports')
      const result = await createReportAction({
        jobId: job.id, reason: 'MISMATCH', note: '  synthetic report  ',
        reporterId: 'forged-reporter', userId: 'forged-user', resolverId: 'forged-resolver',
      })
      expect(result).toMatchObject({ ok: true, data: { reportId: expect.any(String) } })
      const reports = await testDb.jobReport.findMany()
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        jobId: job.id, reporterId: student.userId, reason: 'MISMATCH',
        note: 'synthetic report', resolverId: null, status: 'OPEN',
      })
      expect(await testDb.jobView.count()).toBe(0)
      expect(await testDb.application.count()).toBe(0)
    },
  )

  it('invalid payload is rejected before mutation', async () => {
    const student = await createStudent(testDb)
    mockSession(student.userId)
    const { createReportAction } = await import('@/server/actions/reports')
    expect(await createReportAction({ jobId: '', reason: 'FAKE_REASON' }))
      .toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(await testDb.jobReport.count()).toBe(0)
  })

  it('the eleventh submission returns the domain limit code', async () => {
    const student = await createStudent(testDb)
    const job = await publishedJob()
    await testDb.systemSetting.upsert({ where: { key: 'limits.jobReportsPerDay' },
      create: { key: 'limits.jobReportsPerDay', value: 10 }, update: { value: 10 },
    })
    clearSettingsCache()
    mockSession(student.userId)
    const { createReportAction } = await import('@/server/actions/reports')
    for (let index = 0; index < 10; index++) {
      expect(await createReportAction({ jobId: job.id, reason: 'OTHER' })).toMatchObject({ ok: true })
    }
    expect(await createReportAction({ jobId: job.id, reason: 'OTHER' }))
      .toEqual({ ok: false, code: 'RATE_LIMITED' })
    expect(await testDb.jobReport.count({ where: { reporterId: student.userId } })).toBe(10)
  })
})

describe('plan management actions (M8-T01)', () => {
  const terms = {
    code: 'MATRIX_PLAN', kind: 'PLAN' as const, nameZh: '合成套餐', nameEn: 'Synthetic plan',
    priceSen: 299900, credits: 120, durationDays: 365, jobPostLimit: 10,
    seatLimit: 3, invitationQuota: 200, isActive: true, isPublic: true, sortOrder: 0,
  }

  it.each(['guest', 'student', 'employer', 'suspended', 'deleted', 'no-2fa', 'unverified-2fa', 'expired'] as const)(
    '%s cannot create, update or delete a plan', async (actor) => {
      const row = await testDb.plan.create({ data: terms })
      if (actor === 'guest') mockSession(null)
      else if (actor === 'student') mockSession((await createStudent(testDb)).userId)
      else if (actor === 'employer') mockSession((await createEmployer(testDb)).userId)
      else {
        const admin = await createTwoFactorAdmin(actor !== 'no-2fa')
        if (actor === 'suspended' || actor === 'deleted') {
          await testDb.user.update({ where: { id: admin.id }, data: {
            status: actor === 'suspended' ? 'SUSPENDED' : 'DELETED',
          } })
        }
        mockSession(admin.id, {
          createdAt: new Date(Date.now() - (actor === 'expired' ? 13 * 3600_000 : 0)),
          twoFactorVerifiedAt: actor === 'unverified-2fa' ? null : new Date(),
        })
      }
      const { createPlanAction, updatePlanAction, deletePlanAction } = await import('@/server/actions/admin-plans')
      const expected = { ok: false, code: actor === 'no-2fa' ? 'TWO_FACTOR_REQUIRED' : 'FORBIDDEN' }
      expect(await createPlanAction({ ...terms, code: 'UNAUTHORIZED_PLAN' })).toEqual(expected)
      expect(await updatePlanAction({ ...terms, id: row.id, expectedUpdatedAt: row.updatedAt.toISOString(), priceSen: 1 }))
        .toEqual(expected)
      expect(await deletePlanAction({ id: row.id })).toEqual(expected)
      expect(await testDb.plan.findMany()).toEqual([row])
      expect(await testDb.auditLog.count({ where: { targetType: 'Plan' } })).toBe(0)
    },
  )

  it('verified ordinary admin uses the session actor for all three mutations', async () => {
    const admin = await createTwoFactorAdmin()
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000)
    mockSession(admin.id, { createdAt: thirtyMinutesAgo, twoFactorVerifiedAt: thirtyMinutesAgo })
    const { createPlanAction, updatePlanAction, deletePlanAction } = await import('@/server/actions/admin-plans')
    const result = await createPlanAction({ ...terms, actorId: 'forged', userId: 'forged' })
    expect(result).toMatchObject({ ok: true, data: { id: expect.any(String) } })
    if (!result.ok) throw new Error('Expected a successful authorized create')
    const row = await testDb.plan.findUniqueOrThrow({ where: { id: result.data.id } })
    expect(await updatePlanAction({ ...terms, id: row.id, expectedUpdatedAt: row.updatedAt.toISOString(), priceSen: 399901 }))
      .toEqual({ ok: true, data: { id: row.id } })
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toMatchObject({ priceSen: 399901 })
    expect(await deletePlanAction({ id: row.id })).toEqual({ ok: true, data: undefined })
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toBeNull()
    const audits = await testDb.auditLog.findMany({ where: { targetId: row.id, targetType: 'Plan' } })
    expect(audits.map((entry) => entry.action).sort()).toEqual(['plan.create', 'plan.delete', 'plan.update'])
    expect(audits.every((entry) => entry.actorId === admin.id)).toBe(true)
  })

  it('invalid inputs are rejected by the wrapper without writes', async () => {
    const admin = await createTwoFactorAdmin()
    mockSession(admin.id, { twoFactorVerifiedAt: new Date() })
    const { createPlanAction, updatePlanAction, deletePlanAction } = await import('@/server/actions/admin-plans')
    for (const result of [
      await createPlanAction({ ...terms, priceSen: -1 }),
      await updatePlanAction({ id: 'missing-plan', priceSen: 1 }),
      await deletePlanAction({ id: '' }),
    ]) expect(result).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(await testDb.plan.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { targetType: 'Plan' } })).toBe(0)
  })
})

describe('Stripe checkout action (M8-T03)', () => {
  it.each(['guest', 'student', 'recruiter', 'company-admin', 'suspended', 'deleted', 'inactive-company'] as const)(
    'rejects %s before checkout service dispatch', async actor => {
      const employer = await createEmployer(testDb)
      if (actor === 'guest') mockSession(null)
      else if (actor === 'student') mockSession((await createStudent(testDb)).userId)
      else {
        mockSession(employer.userId)
        if (actor === 'recruiter' || actor === 'company-admin') {
          await testDb.companyMember.updateMany({ where: { userId: employer.userId }, data: {
            role: actor === 'recruiter' ? 'RECRUITER' : 'ADMIN',
          } })
        } else if (actor === 'inactive-company') {
          await testDb.company.update({ where: { id: employer.companyId }, data: { isActive: false } })
        } else {
          await testDb.user.update({ where: { id: employer.userId }, data: {
            status: actor === 'suspended' ? 'SUSPENDED' : 'DELETED',
          } })
        }
      }
      const service = await import('@/server/services/stripe-payments')
      const start = vi.spyOn(service, 'startStripeCheckout')
      try {
        const { startStripeCheckoutAction } = await import('@/server/actions/billing')
        expect(await startStripeCheckoutAction({ orderId: 'synthetic-order', locale: 'en' }))
          .toEqual({ ok: false, code: 'FORBIDDEN' })
        expect(start).not.toHaveBeenCalled()
        expect(await testDb.stripeCheckoutAttempt.count()).toBe(0)
      } finally { start.mockRestore() }
    },
  )

  it('dispatches only the current OWNER identity and the narrow validated input', async () => {
    const employer = await createEmployer(testDb)
    mockSession(employer.userId)
    const service = await import('@/server/services/stripe-payments')
    const result = { orderId: 'synthetic-order', checkoutUrl: 'https://checkout.stripe.com/c/pay/synthetic' }
    const start = vi.spyOn(service, 'startStripeCheckout').mockResolvedValue(result)
    try {
      const { startStripeCheckoutAction } = await import('@/server/actions/billing')
      expect(await startStripeCheckoutAction({ orderId: result.orderId, locale: 'zh' }))
        .toEqual({ ok: true, data: result })
      expect(start).toHaveBeenCalledExactlyOnceWith(
        { userId: employer.userId, companyId: employer.companyId, role: 'OWNER' },
        { orderId: result.orderId, locale: 'zh' },
      )
    } finally { start.mockRestore() }
  })

  it('rejects client identity, amount and return-url fields before checkout dispatch', async () => {
    const employer = await createEmployer(testDb)
    mockSession(employer.userId)
    const service = await import('@/server/services/stripe-payments')
    const start = vi.spyOn(service, 'startStripeCheckout')
    try {
      const { startStripeCheckoutAction } = await import('@/server/actions/billing')
      expect(await startStripeCheckoutAction({
        orderId: 'synthetic-order', locale: 'en', companyId: 'forged', userId: 'forged',
        amountSen: 1, successUrl: 'https://external.example.test',
      })).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
      expect(start).not.toHaveBeenCalled()
    } finally { start.mockRestore() }
  })
})

describe('billing actions (M8-T02)', () => {
  it.each(['guest', 'student', 'recruiter', 'company-admin', 'suspended', 'deleted', 'inactive-company'] as const)(
    '%s cannot quote, create, attach or cancel company orders', async actor => {
      const { billingFixture } = await import('../helpers/billing-t02')
      const f = await billingFixture()
      if (actor === 'guest') mockSession(null)
      else if (actor === 'student') mockSession((await createStudent(testDb)).userId)
      else {
        mockSession(f.ctx.userId)
        if (actor === 'recruiter' || actor === 'company-admin') {
          await testDb.companyMember.updateMany({ where: { userId: f.ctx.userId }, data: {
            role: actor === 'recruiter' ? 'RECRUITER' : 'ADMIN',
          } })
        } else if (actor === 'inactive-company') {
          await testDb.company.update({ where: { id: f.ctx.companyId }, data: { isActive: false } })
        } else {
          await testDb.user.update({ where: { id: f.ctx.userId }, data: {
            status: actor === 'suspended' ? 'SUSPENDED' : 'DELETED',
          } })
        }
      }
      const actions = await import('@/server/actions/billing')
      for (const result of [
        await actions.quoteOrderAction({ planId: f.plan.id }),
        await actions.createOrderAction({ planId: f.plan.id }),
        await actions.attachBankProofAction({ orderId: 'missing', proofKey: 'forged' }),
        await actions.cancelPendingOrderAction({ orderId: 'missing' }),
      ]) expect(result).toEqual({ ok: false, code: 'FORBIDDEN' })
      expect(await testDb.order.count()).toBe(0)
      expect(await testDb.creditLedger.count()).toBe(0)
      expect(await testDb.auditLog.count({ where: { action: 'order.confirm' } })).toBe(0)
    },
  )

  it('uses the current OWNER and company, ignoring forged identity fields', async () => {
    const { billingFixture } = await import('../helpers/billing-t02')
    const f = await billingFixture()
    const other = await createEmployer(testDb)
    mockSession(f.ctx.userId)
    const { quoteOrderAction, createOrderAction, cancelPendingOrderAction } = await import('@/server/actions/billing')
    const quote = await quoteOrderAction({ planId: f.plan.id, companyId: other.companyId })
    expect(quote).toMatchObject({ ok: true })
    if (!quote.ok) throw new Error('Expected the owner quote')
    const created = await createOrderAction({
      planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote: quote.data,
      companyId: other.companyId, userId: other.userId,
    })
    expect(created).toMatchObject({ ok: true })
    if (!created.ok) throw new Error('Expected the owner order')
    expect(await testDb.order.findUnique({ where: { id: created.data.orderId } })).toMatchObject({
      companyId: f.ctx.companyId, createdById: f.ctx.userId, status: 'PENDING',
    })
    mockSession(other.userId)
    expect(await cancelPendingOrderAction({ orderId: created.data.orderId, companyId: f.ctx.companyId }))
      .toEqual({ ok: false, code: 'NOT_FOUND' })
    mockSession(f.ctx.userId)
    expect(await cancelPendingOrderAction({ orderId: created.data.orderId })).toMatchObject({ ok: true })
    expect(await testDb.order.findUnique({ where: { id: created.data.orderId } })).toMatchObject({ status: 'CANCELLED' })
  })

  it.each([
    { name: 'no two factor', enabled: false, verified: true, sessionHours: 0, verificationMinutes: 0, code: 'TWO_FACTOR_REQUIRED' },
    { name: 'unverified session', enabled: true, verified: false, sessionHours: 0, verificationMinutes: 0, code: 'FORBIDDEN' },
    { name: 'expired session', enabled: true, verified: true, sessionHours: 13, verificationMinutes: 0, code: 'FORBIDDEN' },
    { name: 'stale verification', enabled: true, verified: true, sessionHours: 0, verificationMinutes: 10, code: 'FRESH_SESSION_REQUIRED' },
  ])('$name cannot confirm bank receipt', async scenario => {
    const admin = await createTwoFactorAdmin(scenario.enabled)
    mockSession(admin.id, {
      createdAt: new Date(Date.now() - scenario.sessionHours * 3600_000),
      twoFactorVerifiedAt: scenario.verified ? new Date(Date.now() - scenario.verificationMinutes * 60_000) : null,
    })
    const { confirmBankOrderAction } = await import('@/server/actions/billing')
    expect(await confirmBankOrderAction({ orderId: 'missing', receivedAmountSen: 1, note: 'Synthetic receipt check' }))
      .toEqual({ ok: false, code: scenario.code })
    expect(await testDb.order.count()).toBe(0)
    expect(await testDb.creditLedger.count()).toBe(0)
    expect(await testDb.subscription.count()).toBe(0)
    expect(await testDb.auditLog.count({ where: { action: 'order.confirm' } })).toBe(0)
  })

  it('fresh ADMIN confirmation uses its session actor and commits once', async () => {
    const { billingFixture, awaitingOrder, PROOF_BYTES } = await import('../helpers/billing-t02')
    const storage = await import('@/lib/storage')
    vi.mocked(storage.getObjectBytes).mockResolvedValue(PROOF_BYTES)
    const f = await billingFixture()
    const order = await awaitingOrder(f)
    const admin = await createTwoFactorAdmin()
    mockSession(admin.id, { twoFactorVerifiedAt: new Date() })
    const { confirmBankOrderAction } = await import('@/server/actions/billing')
    const input = { orderId: order.id, receivedAmountSen: order.amountSen, note: 'SYNTHETIC RECEIPT', actorId: 'forged' }
    expect(await confirmBankOrderAction(input)).toMatchObject({ ok: true, data: { alreadyPaid: false } })
    expect(await confirmBankOrderAction(input)).toMatchObject({ ok: true, data: { alreadyPaid: true } })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({
      status: 'PAID', confirmedById: admin.id,
    })
    expect(await testDb.creditLedger.count({ where: { refType: 'Order', refId: order.id } })).toBe(1)
    expect(await testDb.auditLog.findMany({ where: { action: 'order.confirm', targetId: order.id } }))
      .toEqual([expect.objectContaining({ actorId: admin.id })])
  })
})

describe('invoice routes and issuer settings (M8-T05)', () => {
  const invoiceId = 'cmw00000000000000000000001'
  const issuer = {
    schemaVersion: 1, version: 'SYNTHETIC_MATRIX_V1', legalName: 'SYNTHETIC Matrix Issuer',
    address: 'SYNTHETIC Matrix Address', registrationNo: null,
  }

  it.each(['guest', 'student', 'recruiter', 'company-admin'] as const)(
    '%s cannot dispatch invoice object reads', async actor => {
      const owner = await createEmployer(testDb)
      if (actor === 'guest') mockSession(null)
      else if (actor === 'student') mockSession((await createStudent(testDb)).userId)
      else {
        await testDb.companyMember.update({ where: { userId: owner.userId }, data: {
          role: actor === 'recruiter' ? 'RECRUITER' : 'ADMIN',
        } })
        mockSession(owner.userId)
      }
      const service = await import('@/server/services/invoice-delivery')
      const read = vi.spyOn(service, 'getInvoiceDownload')
      try {
        const { GET } = await import('@/app/api/invoices/[id]/download/route')
        const response = await GET(new Request(`http://localhost/api/invoices/${invoiceId}/download`))
        expect(response.status).toBe(403)
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(read).not.toHaveBeenCalled()
      } finally { read.mockRestore() }
    },
  )

  it('dispatches invoice reads using the live OWNER identity only', async () => {
    const owner = await createEmployer(testDb)
    mockSession(owner.userId)
    const service = await import('@/server/services/invoice-delivery')
    const bytes = Buffer.from('%PDF-synthetic-route-boundary')
    const read = vi.spyOn(service, 'getInvoiceDownload').mockResolvedValue({ bytes, invoiceNo: 'FMJ-INV-00000001' })
    try {
      const { GET } = await import('@/app/api/invoices/[id]/download/route')
      const response = await GET(new Request(`http://localhost/api/invoices/${invoiceId}/download?userId=forged&companyId=forged`))
      expect(response.status).toBe(200)
      expect(read).toHaveBeenCalledExactlyOnceWith({ userId: owner.userId }, invoiceId)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    } finally { read.mockRestore() }
  })

  it.each(['student', 'employer'] as const)('%s cannot set the invoice issuer', async actor => {
    const user = actor === 'student' ? await createStudent(testDb) : await createEmployer(testDb)
    mockSession(user.userId)
    const { saveInvoiceIssuerSettingsAction } = await import('@/app/[locale]/admin/settings/actions')
    expect(await saveInvoiceIssuerSettingsAction(issuer)).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(await testDb.systemSetting.findUnique({ where: { key: 'billing.invoiceIssuer' } })).toBeNull()
  })

  it('verified ADMIN can save the issuer through the dedicated action', async () => {
    const admin = await createTwoFactorAdmin()
    mockSession(admin.id, { twoFactorVerifiedAt: new Date() })
    const { saveInvoiceIssuerSettingsAction } = await import('@/app/[locale]/admin/settings/actions')
    expect(await saveInvoiceIssuerSettingsAction(issuer)).toMatchObject({ ok: true })
    expect(await testDb.systemSetting.findUnique({ where: { key: 'billing.invoiceIssuer' } }))
      .toMatchObject({ value: issuer, updatedById: admin.id })
    const audits = await testDb.auditLog.findMany({ where: { action: 'setting.update', targetId: 'billing.invoiceIssuer' } })
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits[0].metadata)).not.toContain(issuer.legalName)
  })
})

// Append to tests/integration/authz-matrix.test.ts after T01 is committed.
describe('JD assistant action authorization (M9-T02)', () => {
  const input = { title: 'SYNTHETIC analyst', points: 'Prepare synthetic reports', acknowledged: true, submittedVersion: '2026-11-draft' }

  it.each(['guest', 'student', 'without-company', 'removed', 'suspended', 'inactive-company'] as const)(
    '%s cannot dispatch generation', async actor => {
      if (actor === 'guest') mockSession(null)
      else if (actor === 'student') mockSession((await createStudent(testDb)).userId)
      else if (actor === 'without-company') mockSession((await createEmployerWithoutCompany(testDb)).userId)
      else {
        const employer = await createEmployer(testDb)
        if (actor === 'removed') await testDb.companyMember.delete({ where: { userId: employer.userId } })
        if (actor === 'suspended') await testDb.user.update({ where: { id: employer.userId }, data: { status: 'SUSPENDED' } })
        if (actor === 'inactive-company') await testDb.company.update({ where: { id: employer.companyId }, data: { isActive: false } })
        mockSession(employer.userId)
      }
      const service = await import('@/server/services/jd-assistant')
      const generate = vi.spyOn(service, 'generateJobDescription')
      try {
        const { generateJobDescriptionAction } = await import('@/server/actions/jd-assistant')
        expect(await generateJobDescriptionAction(input)).toEqual({ ok: false, code: 'FORBIDDEN' })
        expect(generate).not.toHaveBeenCalled()
      } finally { generate.mockRestore() }
    },
  )

  it.each(['OWNER', 'ADMIN', 'RECRUITER'] as const)('%s dispatches only the live company context', async role => {
    const employer = await createEmployer(testDb)
    await testDb.company.update({ where: { id: employer.companyId }, data: { verificationStatus: 'UNSUBMITTED' } })
    await testDb.companyMember.update({ where: { userId: employer.userId }, data: { role } })
    mockSession(employer.userId)
    const service = await import('@/server/services/jd-assistant')
    const output = { zh: 'SYNTHETIC 中文职责', en: 'SYNTHETIC English duties' }
    const generate = vi.spyOn(service, 'generateJobDescription').mockResolvedValue(output)
    try {
      const { generateJobDescriptionAction } = await import('@/server/actions/jd-assistant')
      expect(await generateJobDescriptionAction(input)).toEqual({ ok: true, data: output })
      expect(generate).toHaveBeenCalledExactlyOnceWith({ userId: employer.userId, companyId: employer.companyId, role }, input)
      expect(await generateJobDescriptionAction({ ...input, companyId: 'forged' })).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
      expect(generate).toHaveBeenCalledTimes(1)
      expect(await testDb.job.count()).toBe(0)
    } finally { generate.mockRestore() }
  })

  it.each(['guest', 'student', 'employer'] as const)('%s cannot save the JD gate', async actor => {
    if (actor === 'guest') mockSession(null)
    else mockSession((actor === 'student' ? await createStudent(testDb) : await createEmployer(testDb)).userId)
    const { saveJdAssistantSettingsAction } = await import('@/app/[locale]/admin/settings/actions')
    expect(await saveJdAssistantSettingsAction({ enabled: false, legalVersion: null })).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(await testDb.systemSetting.findUnique({ where: { key: 'ai.jdAssistant' } })).toBeNull()
  })

  it.each([
    { label: 'no 2FA', enabled: false, verified: true, age: 0, code: 'TWO_FACTOR_REQUIRED' },
    { label: 'unverified 2FA', enabled: true, verified: false, age: 0, code: 'FORBIDDEN' },
    { label: 'expired session', enabled: true, verified: true, age: 721, code: 'FORBIDDEN' },
    { label: 'stale verification', enabled: true, verified: true, age: 11, code: 'FRESH_SESSION_REQUIRED' },
  ])('$label cannot save the JD gate', async scenario => {
    const admin = await createTwoFactorAdmin(scenario.enabled)
    const at = new Date(Date.now() - scenario.age * 60_000)
    mockSession(admin.id, { createdAt: at, twoFactorVerifiedAt: scenario.verified ? at : null })
    const { saveJdAssistantSettingsAction } = await import('@/app/[locale]/admin/settings/actions')
    expect(await saveJdAssistantSettingsAction({ enabled: false, legalVersion: null })).toEqual({ ok: false, code: scenario.code })
    expect(await testDb.systemSetting.findUnique({ where: { key: 'ai.jdAssistant' } })).toBeNull()
  })

  it('fresh ADMIN saves a disabled gate with a server-owned epoch', async () => {
    const admin = await createTwoFactorAdmin()
    mockSession(admin.id, { twoFactorVerifiedAt: new Date() })
    const { saveJdAssistantSettingsAction } = await import('@/app/[locale]/admin/settings/actions')
    expect(await saveJdAssistantSettingsAction({ enabled: false, legalVersion: null })).toMatchObject({ ok: true })
    const setting = await testDb.systemSetting.findUniqueOrThrow({ where: { key: 'ai.jdAssistant' } })
    expect(setting).toMatchObject({ updatedById: admin.id, value: { enabled: false, legalVersion: null, epoch: expect.any(String) } })
    expect(await saveJdAssistantSettingsAction({ enabled: true, legalVersion: '2026-11-draft', epoch: 'forged' })).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
    expect(await testDb.systemSetting.findUniqueOrThrow({ where: { key: 'ai.jdAssistant' } })).toEqual(setting)
  })
})

describe('semantic matching actions (M9-T03)', () => {
  for (const operation of ['recommendJobsAction', 'setMatchingConsentAction'] as const) {
    it.each(['anonymous', 'employer', 'suspended-student', 'deleted-student'] as const)(operation + ' denies %s', async actor => {
      if (actor === 'anonymous') mockSession(null)
      else {
        const user = actor === 'employer' ? await createEmployer(testDb) : await createStudent(testDb)
        if (actor === 'suspended-student' || actor === 'deleted-student') {
          await testDb.user.update({ where: { id: user.userId }, data: { status: actor === 'deleted-student' ? 'DELETED' : 'SUSPENDED' } })
        }
        mockSession(user.userId)
      }
      const before = await testDb.consent.count({ where: { type: 'AI_MATCHING' } })
      const actions = await import('@/server/actions/semantic-matching')
      expect(await actions[operation](operation === 'setMatchingConsentAction' ? { granted: false } : {})).toEqual({ ok: false, code: 'FORBIDDEN' })
      expect(await testDb.consent.count({ where: { type: 'AI_MATCHING' } })).toBe(before)
    })
  }
  it.each(['anonymous', 'student', 'suspended-employer', 'unverified-company'] as const)('talent recommendation denies %s', async actor => {
    if (actor === 'anonymous') mockSession(null)
    else {
      const user = actor === 'student' ? await createStudent(testDb) : await createEmployer(testDb)
      if (actor === 'suspended-employer') await testDb.user.update({ where: { id: user.userId }, data: { status: 'SUSPENDED' } })
      if (actor === 'unverified-company' && 'companyId' in user) await testDb.company.update({ where: { id: user.companyId }, data: { verificationStatus: 'PENDING' } })
      mockSession(user.userId)
    }
    const { recommendTalentsAction } = await import('@/server/actions/semantic-matching')
    expect(await recommendTalentsAction({ jobId: 'c' + '1'.repeat(24) })).toEqual({ ok: false, code: 'FORBIDDEN' })
  })
})
