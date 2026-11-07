/**
 * Integration tests for managed company service (M6-T07).
 * Tests createManagedCompany, postJobAsPlatform, transferCompany, acceptManagedTransfer.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/email', () => ({
  createEmailProvider: vi.fn(() => ({ sendEmail: vi.fn().mockResolvedValue(undefined) })),
}))

vi.mock('next/server', () => ({
  after: vi.fn((cb: () => unknown) => { void cb() }),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createEmployerWithoutCompany, faker } from '../factories'
import {
  createManagedCompany,
  postJobAsPlatform,
  transferCompany,
  acceptManagedTransfer,
} from '@/server/services/managed-company'
import { acceptInvite } from '@/server/services/team'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
import { createEmailProvider } from '@/lib/email'
import * as authMod from '@/server/auth'
import type { UserCtx } from '@/server/authz'

setupTestDb()

beforeEach(() => {
  vi.clearAllMocks()
})

async function makeAdminCtx(): Promise<UserCtx> {
  const { userId } = await createAdmin(testDb)
  return { userId }
}

async function makeStudentCtx(): Promise<UserCtx> {
  const user = await testDb.user.create({
    data: {
      name: faker.person.fullName(),
      email: `s-${Date.now()}@example.test`,
      emailVerified: true,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  })
  return { userId: user.id }
}

const baseInput = {
  legalName: 'Test Managed Co Sdn. Bhd.',
  website: 'https://test-managed.example.com',
}

// ---------------------------------------------------------------------------
// createManagedCompany
// ---------------------------------------------------------------------------

describe('createManagedCompany', () => {
  it('admin creates managed company with isManaged=true and VERIFIED status', async () => {
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, { ...baseInput, legalName: `MCo-${Date.now()}` })
    expect(company.isManaged).toBe(true)
    expect(company.verificationStatus).toBe('VERIFIED')
    expect(company.verifiedAt).not.toBeNull()
    // Audit log written
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.managed.create', targetId: company.id },
    })
    expect(audit).not.toBeNull()
  })

  it('non-admin user is rejected', async () => {
    const { userId } = await createEmployer(testDb)
    await expect(createManagedCompany({ userId }, baseInput)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('student is rejected', async () => {
    const ctx = await makeStudentCtx()
    await expect(createManagedCompany(ctx, baseInput)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('suspended admin is rejected', async () => {
    const admin = await testDb.user.create({
      data: {
        name: faker.person.fullName(),
        email: `suspended-admin-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'ADMIN',
        status: 'SUSPENDED',
      },
    })
    await expect(createManagedCompany({ userId: admin.id }, baseInput)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('admin can create multiple managed companies (no member constraint)', async () => {
    const ctx = await makeAdminCtx()
    const c1 = await createManagedCompany(ctx, { legalName: `MCo-A-${Date.now()}` })
    const c2 = await createManagedCompany(ctx, { legalName: `MCo-B-${Date.now()}` })
    expect(c1.id).not.toBe(c2.id)
  })

  it('M4-T20: new managed company has wallet with balance equal to pilot.monthlyCredits (default 30)', async () => {
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, { legalName: `MCo-Wallet-${Date.now()}` })

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId: company.id } })
    expect(wallet).not.toBeNull()
    expect(wallet?.balance).toBe(30)

    const ledger = await testDb.creditLedger.findMany({
      where: { wallet: { companyId: company.id } },
    })
    expect(ledger).toHaveLength(1)
    expect(ledger[0].refType).toBe('PilotPeriod')
  })
})

// ---------------------------------------------------------------------------
// postJobAsPlatform
// ---------------------------------------------------------------------------

describe('postJobAsPlatform', () => {
  const jobInput = {
    title: 'Platform Test Job',
    type: 'INTERNSHIP' as const,
    description: 'A test job posted by platform',
    workMode: 'ONSITE' as const,
    submit: false,
    salaryVisible: true,
    acceptsStudentPass: false,
    sponsorsWorkPass: false,
    languages: [],
    skills: [],
  }

  it('admin posts job as PUBLISHED, skipping review', async () => {
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, { legalName: `MCo-Job-${Date.now()}` })
    const job = await postJobAsPlatform(ctx, company.id, jobInput)
    expect(job.status).toBe('PUBLISHED')
    expect(job.publishedAt).not.toBeNull()
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.managed.post', targetId: job.id },
    })
    expect(audit).not.toBeNull()
  })

  it('approvedJobCount NOT incremented for platform posts (bypasses review queue)', async () => {
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, { legalName: `MCo-Cnt-${Date.now()}` })
    expect(company.approvedJobCount).toBe(0)
    await postJobAsPlatform(ctx, company.id, jobInput)
    const updated = await testDb.company.findUnique({ where: { id: company.id } })
    expect(updated!.approvedJobCount).toBe(0)
  })

  it('non-managed company is rejected', async () => {
    const ctx = await makeAdminCtx()
    const { companyId } = await createEmployer(testDb)
    await expect(postJobAsPlatform(ctx, companyId, jobInput)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('non-admin is rejected', async () => {
    const adminCtx = await makeAdminCtx()
    const company = await createManagedCompany(adminCtx, { legalName: `MCo-NAdm-${Date.now()}` })
    const { userId } = await createEmployer(testDb)
    await expect(postJobAsPlatform({ userId }, company.id, jobInput)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('non-existent company returns NotFoundError', async () => {
    const ctx = await makeAdminCtx()
    await expect(postJobAsPlatform(ctx, 'nonexistent-id', jobInput)).rejects.toBeInstanceOf(NotFoundError)
  })
})

// ---------------------------------------------------------------------------
// transferCompany
// ---------------------------------------------------------------------------

describe('transferCompany', () => {
  it('admin initiates transfer, creates invite with OWNER role', async () => {
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, { legalName: `MCo-Tr-${Date.now()}` })
    const result = await transferCompany(ctx, company.id, {
      ownerEmail: 'newowner@example.test',
      verificationRecord: 'Phone callback confirmed per SOP',
      verificationMethod: 'PHONE_CALLBACK',
    })
    expect(typeof result.token).toBe('string')
    // Invite created
    const invite = await testDb.companyInvite.findFirst({
      where: { companyId: company.id, email: 'newowner@example.test' },
    })
    expect(invite).not.toBeNull()
    expect(invite!.role).toBe('OWNER')
    // Audit log written with verificationRecord
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.managed.transfer', targetId: company.id },
    })
    expect(audit).not.toBeNull()
    expect((audit!.metadata as Record<string, unknown>)['verificationRecord']).toBeTruthy()
  })

  it('missing verificationRecord returns ValidationError', async () => {
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, { legalName: `MCo-VR-${Date.now()}` })
    await expect(
      transferCompany(ctx, company.id, { ownerEmail: 'x@example.test', verificationRecord: '', verificationMethod: 'PHONE_CALLBACK' }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      transferCompany(ctx, company.id, { ownerEmail: 'x@example.test', verificationRecord: '   ', verificationMethod: 'PHONE_CALLBACK' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('non-managed company is rejected', async () => {
    const ctx = await makeAdminCtx()
    const { companyId } = await createEmployer(testDb)
    await expect(
      transferCompany(ctx, companyId, {
        ownerEmail: 'x@example.test',
        verificationRecord: 'verified',
        verificationMethod: 'PHONE_CALLBACK',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('non-admin is rejected', async () => {
    const adminCtx = await makeAdminCtx()
    const company = await createManagedCompany(adminCtx, { legalName: `MCo-NAdmTr-${Date.now()}` })
    const { userId } = await createEmployer(testDb)
    await expect(
      transferCompany({ userId }, company.id, {
        ownerEmail: 'x@example.test',
        verificationRecord: 'verified',
        verificationMethod: 'PHONE_CALLBACK',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------------------------------------------------------------------------
// acceptManagedTransfer
// ---------------------------------------------------------------------------

describe('acceptManagedTransfer', () => {
  async function setupTransfer(email: string) {
    const adminCtx = await makeAdminCtx()
    const company = await createManagedCompany(adminCtx, { legalName: `MCo-Acc-${Date.now()}` })
    const { token } = await transferCompany(adminCtx, company.id, {
      ownerEmail: email,
      verificationRecord: 'Phone callback confirmed per SOP',
      verificationMethod: 'PHONE_CALLBACK',
    })
    return { company, token, adminCtx }
  }

  it('new owner accepts transfer: isManaged=false, becomes OWNER member', async () => {
    const email = `newowner-${Date.now()}@example.test`
    const { company, token } = await setupTransfer(email)

    const { userId } = await createEmployerWithoutCompany(testDb, { email })
    await acceptManagedTransfer({ userId }, token)

    const updated = await testDb.company.findUnique({ where: { id: company.id } })
    expect(updated!.isManaged).toBe(false)

    const member = await testDb.companyMember.findFirst({ where: { userId, companyId: company.id } })
    expect(member).not.toBeNull()
    expect(member!.role).toBe('OWNER')
  })

  it('after transfer, postJobAsPlatform is rejected (isManaged=false)', async () => {
    const email = `newowner2-${Date.now()}@example.test`
    const { company, token, adminCtx } = await setupTransfer(email)
    const { userId } = await createEmployerWithoutCompany(testDb, { email })
    await acceptManagedTransfer({ userId }, token)

    const jobInput = {
      title: 'Post-transfer job',
      type: 'FULL_TIME' as const,
      description: 'Should be rejected',
      workMode: 'ONSITE' as const,
      submit: false,
      salaryVisible: true,
      acceptsStudentPass: false,
      sponsorsWorkPass: false,
      languages: [],
      skills: [],
    }
    await expect(postJobAsPlatform(adminCtx, company.id, jobInput)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('wrong email is rejected', async () => {
    const email = `correct-${Date.now()}@example.test`
    const { token } = await setupTransfer(email)
    const { userId } = await createEmployerWithoutCompany(testDb, { email: `wrong-${Date.now()}@example.test` })
    await expect(acceptManagedTransfer({ userId }, token)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('already-member employer is rejected', async () => {
    const email = `member-${Date.now()}@example.test`
    const { token } = await setupTransfer(email)
    const { userId } = await createEmployer(testDb, { email })
    await expect(acceptManagedTransfer({ userId }, token)).rejects.toBeInstanceOf(ValidationError)
  })

  it('expired invite is rejected', async () => {
    const email = `expired-${Date.now()}@example.test`
    const { company, token } = await setupTransfer(email)
    // Expire the invite
    await testDb.companyInvite.updateMany({
      where: { companyId: company.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const { userId } = await createEmployerWithoutCompany(testDb, { email })
    await expect(acceptManagedTransfer({ userId }, token)).rejects.toBeInstanceOf(ValidationError)
  })

  it('student cannot accept', async () => {
    const email = `student-tr-${Date.now()}@example.test`
    const { token } = await setupTransfer(email)
    const user = await testDb.user.create({
      data: {
        name: 'Student',
        email,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    await expect(acceptManagedTransfer({ userId: user.id }, token)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('writes company.managed.transfer (completed) and company.invite.accept audit logs, no email in metadata', async () => {
    const email = `audit-tr-${Date.now()}@example.test`
    const { company, token } = await setupTransfer(email)
    const { userId } = await createEmployerWithoutCompany(testDb, { email })
    await acceptManagedTransfer({ userId }, token)

    const invite = await testDb.companyInvite.findFirst({ where: { companyId: company.id } })
    const completedAudit = await testDb.auditLog.findFirst({
      where: { action: 'company.managed.transfer', targetId: company.id, actorId: userId },
    })
    expect(completedAudit).not.toBeNull()
    const meta = completedAudit!.metadata as Record<string, unknown>
    expect(meta['phase']).toBe('completed')
    expect(meta['inviteId']).toBe(invite!.id)
    expect(meta).not.toHaveProperty('email')
    expect(meta).not.toHaveProperty('ownerEmail')
    expect(meta).not.toHaveProperty('token')

    const acceptAudit = await testDb.auditLog.findFirst({
      where: { action: 'company.invite.accept', targetId: company.id, actorId: userId },
    })
    expect(acceptAudit).not.toBeNull()
    expect((acceptAudit!.metadata as Record<string, unknown>)['role']).toBe('OWNER')
  })

  it('second pending transfer invite is revoked after first is accepted', async () => {
    const email1 = `revoke1-${Date.now()}@example.test`
    const email2 = `revoke2-${Date.now()}@example.test`
    const adminCtx = await makeAdminCtx()
    const company = await createManagedCompany(adminCtx, { legalName: `MCo-Rev-${Date.now()}` })
    const { token: token1 } = await transferCompany(adminCtx, company.id, {
      ownerEmail: email1,
      verificationRecord: 'Phone callback',
      verificationMethod: 'PHONE_CALLBACK',
    })
    const { token: token2 } = await transferCompany(adminCtx, company.id, {
      ownerEmail: email2,
      verificationRecord: 'Phone callback',
      verificationMethod: 'PHONE_CALLBACK',
    })
    const { userId: uid1 } = await createEmployerWithoutCompany(testDb, { email: email1 })
    const { userId: uid2 } = await createEmployerWithoutCompany(testDb, { email: email2 })

    // First accept succeeds
    await acceptManagedTransfer({ userId: uid1 }, token1)

    // Second invite was revoked in the same transaction — should not be accepted
    await expect(acceptManagedTransfer({ userId: uid2 }, token2)).rejects.toBeInstanceOf(ValidationError)
  })

  it('via team.acceptInvite: managed company transfer → isManaged=false, becomes OWNER', async () => {
    const email = `via-team-${Date.now()}@example.test`
    const adminCtx = await makeAdminCtx()
    const company = await createManagedCompany(adminCtx, { legalName: `MCo-Via-${Date.now()}` })
    const { token } = await transferCompany(adminCtx, company.id, {
      ownerEmail: email,
      verificationRecord: 'Phone callback confirmed',
      verificationMethod: 'PHONE_CALLBACK',
    })
    const { userId } = await createEmployerWithoutCompany(testDb, { email })

    // The user-facing flow uses team.acceptInvite, NOT acceptManagedTransfer directly
    await acceptInvite({ userId }, token)

    const updated = await testDb.company.findUnique({ where: { id: company.id } })
    expect(updated!.isManaged).toBe(false)
    const member = await testDb.companyMember.findFirst({ where: { userId, companyId: company.id } })
    expect(member).not.toBeNull()
    expect(member!.role).toBe('OWNER')
  })

  it('via team.acceptInvite: after transfer, postJobAsPlatform is rejected', async () => {
    const email = `via-team-rej-${Date.now()}@example.test`
    const adminCtx = await makeAdminCtx()
    const company = await createManagedCompany(adminCtx, { legalName: `MCo-ViaRej-${Date.now()}` })
    const { token } = await transferCompany(adminCtx, company.id, {
      ownerEmail: email,
      verificationRecord: 'Phone callback',
      verificationMethod: 'PHONE_CALLBACK',
    })
    const { userId } = await createEmployerWithoutCompany(testDb, { email })
    await acceptInvite({ userId }, token)

    const jobInput = {
      title: 'Post-transfer job',
      type: 'FULL_TIME' as const,
      description: 'Should be rejected',
      workMode: 'ONSITE' as const,
      submit: false,
      salaryVisible: true,
      acceptsStudentPass: false,
      sponsorsWorkPass: false,
      languages: [],
      skills: [],
    }
    await expect(postJobAsPlatform(adminCtx, company.id, jobInput)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('concurrent dual-accept: only one succeeds, lockXact serialises transfers', async () => {
    // Both invites are valid and un-expired at the same time.
    // Promise.all drives true concurrent transactions; lockXact on companyId prevents deadlock.
    const email1 = `con1-${Date.now()}@example.test`
    const email2 = `con2-${Date.now()}@example.test`
    const adminCtx = await makeAdminCtx()
    const company = await createManagedCompany(adminCtx, { legalName: `MCo-Con-${Date.now()}` })
    const { token: t1 } = await transferCompany(adminCtx, company.id, {
      ownerEmail: email1,
      verificationRecord: 'Phone callback',
      verificationMethod: 'PHONE_CALLBACK',
    })
    const { token: t2 } = await transferCompany(adminCtx, company.id, {
      ownerEmail: email2,
      verificationRecord: 'Phone callback',
      verificationMethod: 'PHONE_CALLBACK',
    })
    // Both invites are valid; un-expire t2 (revoked by t1 setup above is not an issue here
    // since both invites are still active at this point - transferCompany creates them, not revokes)
    const { userId: uid1 } = await createEmployerWithoutCompany(testDb, { email: email1 })
    const { userId: uid2 } = await createEmployerWithoutCompany(testDb, { email: email2 })

    // Run both concurrently — exactly one must succeed, one must throw ValidationError
    const results = await Promise.allSettled([
      acceptManagedTransfer({ userId: uid1 }, t1),
      acceptManagedTransfer({ userId: uid2 }, t2),
    ])

    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(ValidationError)

    // Exactly one OWNER member exists
    const members = await testDb.companyMember.findMany({ where: { companyId: company.id } })
    expect(members).toHaveLength(1)
    expect(members[0].role).toBe('OWNER')
  })
})

// ---------------------------------------------------------------------------
// non-managed company OWNER invite rejection
// ---------------------------------------------------------------------------

describe('team.acceptInvite OWNER invite rejection', () => {
  it('OWNER invite for non-managed company via acceptInvite → ForbiddenError', async () => {
    // Insert an OWNER invite directly (bypassing the service guard) to simulate a stale/invalid invite
    const { userId, companyId } = await createEmployer(testDb)
    const email = `owner-inv-${Date.now()}@example.test`
    const { createHash, randomBytes } = await import('crypto')
    const rawToken = randomBytes(32).toString('base64url')
    const hash = createHash('sha256').update(rawToken).digest('hex')
    await testDb.companyInvite.create({
      data: {
        companyId,
        email,
        role: 'OWNER',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdById: userId,
      },
    })
    const target = await testDb.user.create({
      data: { name: 'Target', email, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await expect(acceptInvite({ userId: target.id }, rawToken)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('non-OWNER invite for managed company via acceptInvite → ForbiddenError', async () => {
    const adminCtx = await makeAdminCtx()
    const company = await createManagedCompany(adminCtx, { legalName: `MCo-NOwnerManaged-${Date.now()}` })
    const email = `non-owner-managed-${Date.now()}@example.test`
    const { createHash, randomBytes } = await import('crypto')
    const rawToken = randomBytes(32).toString('base64url')
    const hash = createHash('sha256').update(rawToken).digest('hex')
    // Insert an ADMIN-role invite directly for the managed company
    await testDb.companyInvite.create({
      data: {
        companyId: company.id,
        email,
        role: 'ADMIN',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdById: adminCtx.userId,
      },
    })
    const target = await testDb.user.create({
      data: { name: 'Target', email, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await expect(acceptInvite({ userId: target.id }, rawToken)).rejects.toBeInstanceOf(ForbiddenError)
    // Company must still be managed (no member was added)
    const updated = await testDb.company.findUnique({ where: { id: company.id } })
    expect(updated!.isManaged).toBe(true)
    const member = await testDb.companyMember.findFirst({ where: { companyId: company.id } })
    expect(member).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// transferCompany verificationMethod
// ---------------------------------------------------------------------------

describe('transferCompany verificationMethod', () => {
  it('DOMAIN_MATCH with matching domain → succeeds', async () => {
    const ctx = await makeAdminCtx()
    // company.website = 'https://test-managed.example.com' (baseInput)
    const company = await createManagedCompany(ctx, {
      legalName: `MCo-DM-${Date.now()}`,
      website: 'https://corp.example.com',
    })
    const result = await transferCompany(ctx, company.id, {
      ownerEmail: 'owner@example.com',
      verificationRecord: 'Domain match confirmed',
      verificationMethod: 'DOMAIN_MATCH',
    })
    expect(typeof result.token).toBe('string')
    // audit contains verificationMethod
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.managed.transfer', targetId: company.id },
    })
    expect((audit!.metadata as Record<string, unknown>)['verificationMethod']).toBe('DOMAIN_MATCH')
  })

  it('DOMAIN_MATCH with mismatched domain → ValidationError', async () => {
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, {
      legalName: `MCo-DM-Fail-${Date.now()}`,
      website: 'https://corp.example.com',
    })
    await expect(
      transferCompany(ctx, company.id, {
        ownerEmail: 'owner@other.com',
        verificationRecord: 'Domain match',
        verificationMethod: 'DOMAIN_MATCH',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('DOMAIN_MATCH without website → ValidationError', async () => {
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, { legalName: `MCo-DM-NoWeb-${Date.now()}` })
    await expect(
      transferCompany(ctx, company.id, {
        ownerEmail: 'owner@example.com',
        verificationRecord: 'Domain match',
        verificationMethod: 'DOMAIN_MATCH',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('DOMAIN_MATCH rejects public suffix as email domain (PSL check)', async () => {
    // email @co.uk is a public suffix — should NOT match a company website like corp.co.uk
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, {
      legalName: `MCo-DM-PSL-${Date.now()}`,
      website: 'https://corp.co.uk',
    })
    await expect(
      transferCompany(ctx, company.id, {
        ownerEmail: 'admin@co.uk',
        verificationRecord: 'Domain match',
        verificationMethod: 'DOMAIN_MATCH',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('DOMAIN_MATCH accepts subdomain of same registerable domain', async () => {
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, {
      legalName: `MCo-DM-Sub-${Date.now()}`,
      website: 'https://careers.techcorp.com',
    })
    // owner@techcorp.com shares the same registerable domain as careers.techcorp.com
    const result = await transferCompany(ctx, company.id, {
      ownerEmail: 'owner@techcorp.com',
      verificationRecord: 'Domain match confirmed',
      verificationMethod: 'DOMAIN_MATCH',
    })
    expect(typeof result.token).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// transferManagedCompanyAction
// ---------------------------------------------------------------------------

function mockAdminSession(userId: string) {
  vi.mocked(authMod.getSession).mockResolvedValue({
    user: {
      id: userId,
      name: '',
      email: '',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      image: null,
      role: 'ADMIN',
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

describe('transferManagedCompanyAction', () => {
  it('non-admin is rejected', async () => {
    const { userId } = await createEmployer(testDb)
    mockAdminSession(userId) // employer session, but role check inside action will reject
    // Manually override to employer role since mockAdminSession sets ADMIN
    vi.mocked(authMod.getSession).mockResolvedValue({
      user: {
        id: userId, name: '', email: '', emailVerified: true,
        createdAt: new Date(), updatedAt: new Date(), image: null,
        role: 'EMPLOYER', locale: 'zh', status: 'ACTIVE',
      } as never,
      session: {
        id: '', userId, token: '', expiresAt: new Date(Date.now() + 86_400_000),
        ipAddress: null, userAgent: null, createdAt: new Date(), updatedAt: new Date(),
      },
    })
    const { transferManagedCompanyAction } = await import('@/server/actions/managed-company')
    const adminCtx = await makeAdminCtx()
    const company = await createManagedCompany(adminCtx, { legalName: `MCo-Act-NAdm-${Date.now()}` })
    const result = await transferManagedCompanyAction({
      companyId: company.id,
      transfer: { ownerEmail: 'x@example.test', verificationRecord: 'rec', verificationMethod: 'PHONE_CALLBACK' },
    })
    expect(result.ok).toBe(false)
  })

  it('admin action returns no token, email mock receives accept URL', async () => {
    const { userId: adminId } = await createAdmin(testDb)
    mockAdminSession(adminId)
    const adminCtx = { userId: adminId }
    const company = await createManagedCompany(adminCtx, { legalName: `MCo-Act-Ok-${Date.now()}` })

    const mockSendEmail = vi.fn().mockResolvedValue(undefined)
    vi.mocked(createEmailProvider).mockReturnValue({ sendEmail: mockSendEmail })

    const { transferManagedCompanyAction } = await import('@/server/actions/managed-company')
    const result = await transferManagedCompanyAction({
      companyId: company.id,
      transfer: {
        ownerEmail: 'newowner@example.test',
        verificationRecord: 'Phone callback confirmed',
        verificationMethod: 'PHONE_CALLBACK',
      },
    })

    expect(result.ok).toBe(true)
    // token must NOT appear in the response
    expect(result).not.toHaveProperty('token')
    expect(result.ok && result.data).not.toHaveProperty('token')

    // email should have been sent with an accept link
    expect(mockSendEmail).toHaveBeenCalledOnce()
    const callArgs = mockSendEmail.mock.calls[0][0] as { to: string; html: string }
    expect(callArgs.to).toBe('newowner@example.test')
    expect(callArgs.html).toContain('/e/team/accept?token=')
  })
})
