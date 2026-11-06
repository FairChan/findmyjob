/**
 * Integration tests for managed company service (M6-T07).
 * Tests createManagedCompany, postJobAsPlatform, transferCompany, acceptManagedTransfer.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

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
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
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

  it('admin can create multiple managed companies (no member constraint)', async () => {
    const ctx = await makeAdminCtx()
    const c1 = await createManagedCompany(ctx, { legalName: `MCo-A-${Date.now()}` })
    const c2 = await createManagedCompany(ctx, { legalName: `MCo-B-${Date.now()}` })
    expect(c1.id).not.toBe(c2.id)
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

  it('approvedJobCount incremented after platform post', async () => {
    const ctx = await makeAdminCtx()
    const company = await createManagedCompany(ctx, { legalName: `MCo-Cnt-${Date.now()}` })
    expect(company.approvedJobCount).toBe(0)
    await postJobAsPlatform(ctx, company.id, jobInput)
    const updated = await testDb.company.findUnique({ where: { id: company.id } })
    expect(updated!.approvedJobCount).toBe(1)
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
      verificationRecord: 'Domain match: example.test matches company website',
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
      transferCompany(ctx, company.id, { ownerEmail: 'x@example.test', verificationRecord: '' }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      transferCompany(ctx, company.id, { ownerEmail: 'x@example.test', verificationRecord: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('non-managed company is rejected', async () => {
    const ctx = await makeAdminCtx()
    const { companyId } = await createEmployer(testDb)
    await expect(
      transferCompany(ctx, companyId, {
        ownerEmail: 'x@example.test',
        verificationRecord: 'verified',
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
})
