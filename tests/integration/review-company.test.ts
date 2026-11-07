/**
 * Integration tests for the company review service (M3-T03).
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
import { createAdmin, createStudent, createEmployer } from '../factories'
import {
  approveCompany,
  rejectCompany,
  listPendingVerifications,
  getCompanyForReview,
} from '@/server/services/review-company'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'
import { requireAdmin } from '@/server/authz'

setupTestDb()

async function makeAdminCtx() {
  const { userId } = await createAdmin(testDb)
  return { userId }
}

async function makeEmployerWithPending() {
  const { userId: ownerId, companyId } = await createEmployer(testDb)

  // Set company to PENDING
  await testDb.company.update({
    where: { id: companyId },
    data: { verificationStatus: 'PENDING' },
  })

  // Create a pending CompanyVerification
  const cv = await testDb.companyVerification.create({
    data: {
      companyId,
      documentKeys: [`verifications/${companyId}/ssm.pdf`],
      status: 'PENDING',
      submittedById: ownerId,
    },
  })

  return { ownerId, companyId, verificationId: cv.id }
}

describe('approveCompany', () => {
  it('sets company to VERIFIED and creates CreditWallet', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, verificationId } = await makeEmployerWithPending()

    await approveCompany(adminCtx, {
      verificationId,
      verifiedChannels: ['SSM'],
      verificationResult: 'SSM record confirmed, company is active',
    })

    const company = await testDb.company.findUnique({ where: { id: companyId } })
    expect(company?.verificationStatus).toBe('VERIFIED')
    expect(company?.verifiedAt).not.toBeNull()

    const wallet = await testDb.creditWallet.findUnique({ where: { companyId } })
    expect(wallet).not.toBeNull()
    // balance is topped up immediately to pilot.monthlyCredits (default 30)
    expect(wallet?.balance).toBe(30)
  })

  it('updates CompanyVerification with reviewNote containing channels and result', async () => {
    const adminCtx = await makeAdminCtx()
    const { verificationId } = await makeEmployerWithPending()

    await approveCompany(adminCtx, {
      verificationId,
      verifiedChannels: ['SSM', 'WEBSITE'],
      verificationResult: 'Confirmed via website and SSM',
    })

    const cv = await testDb.companyVerification.findUnique({ where: { id: verificationId } })
    expect(cv?.status).toBe('VERIFIED')
    expect(cv?.reviewNote).toContain('SSM')
    expect(cv?.reviewNote).toContain('WEBSITE')
    expect(cv?.reviewNote).toContain('Confirmed via website and SSM')
    expect(cv?.reviewerId).toBe(adminCtx.userId)
    expect(cv?.reviewedAt).not.toBeNull()
  })

  it('writes company.verify audit log with channels and result in metadata', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, verificationId } = await makeEmployerWithPending()

    await approveCompany(adminCtx, {
      verificationId,
      verifiedChannels: ['PHONE'],
      verificationResult: 'Called public number, confirmed',
    })

    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.verify', targetId: companyId },
    })
    expect(audit).not.toBeNull()
    expect(audit?.actorId).toBe(adminCtx.userId)
    const meta = audit?.metadata as Record<string, unknown>
    expect(meta?.channels).toEqual(['PHONE'])
    expect(meta?.verificationResult).toBe('Called public number, confirmed')
  })

  it('creates Notification for OWNER', async () => {
    const adminCtx = await makeAdminCtx()
    const { ownerId, verificationId } = await makeEmployerWithPending()

    await approveCompany(adminCtx, {
      verificationId,
      verifiedChannels: ['SSM'],
      verificationResult: 'Confirmed',
    })

    const notif = await testDb.notification.findFirst({
      where: { userId: ownerId, type: 'company.verified' },
    })
    expect(notif).not.toBeNull()
  })

  it('throws ValidationError when no channels provided', async () => {
    const adminCtx = await makeAdminCtx()
    const { verificationId } = await makeEmployerWithPending()

    await expect(
      approveCompany(adminCtx, {
        verificationId,
        verifiedChannels: [],
        verificationResult: 'Some result',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('throws NotFoundError for non-existent verificationId', async () => {
    const adminCtx = await makeAdminCtx()

    await expect(
      approveCompany(adminCtx, {
        verificationId: 'non-existent-id',
        verifiedChannels: ['SSM'],
        verificationResult: 'Confirmed',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ValidationError if verification is not PENDING', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, ownerId } = await makeEmployerWithPending()

    // Create a REJECTED verification instead
    const cv = await testDb.companyVerification.create({
      data: {
        companyId,
        documentKeys: [`verifications/${companyId}/other.pdf`],
        status: 'REJECTED',
        submittedById: ownerId,
      },
    })

    await expect(
      approveCompany(adminCtx, {
        verificationId: cv.id,
        verifiedChannels: ['SSM'],
        verificationResult: 'Confirmed',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('rejectCompany', () => {
  it('sets company to REJECTED with reviewNote', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, verificationId } = await makeEmployerWithPending()

    await rejectCompany(adminCtx, {
      verificationId,
      reviewNote: 'SSM document expired and mismatch',
    })

    const company = await testDb.company.findUnique({ where: { id: companyId } })
    expect(company?.verificationStatus).toBe('REJECTED')

    const cv = await testDb.companyVerification.findUnique({ where: { id: verificationId } })
    expect(cv?.status).toBe('REJECTED')
    expect(cv?.reviewNote).toBe('SSM document expired and mismatch')
    expect(cv?.reviewerId).toBe(adminCtx.userId)
  })

  it('creates Notification for OWNER on rejection', async () => {
    const adminCtx = await makeAdminCtx()
    const { ownerId, verificationId } = await makeEmployerWithPending()

    await rejectCompany(adminCtx, { verificationId, reviewNote: 'Documents unclear' })

    const notif = await testDb.notification.findFirst({
      where: { userId: ownerId, type: 'company.rejected' },
    })
    expect(notif).not.toBeNull()
  })

  it('writes company.reject audit log', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId, verificationId } = await makeEmployerWithPending()

    await rejectCompany(adminCtx, { verificationId, reviewNote: 'Unclear docs' })

    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.reject', targetId: companyId },
    })
    expect(audit).not.toBeNull()
    const meta = audit?.metadata as Record<string, unknown>
    expect(meta?.reviewNote).toBe('Unclear docs')
  })

  it('throws NotFoundError for non-existent verificationId', async () => {
    const adminCtx = await makeAdminCtx()

    await expect(
      rejectCompany(adminCtx, { verificationId: 'bad-id', reviewNote: 'reason' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('authz: non-ADMIN cannot call review functions', () => {
  it('requireAdmin throws ForbiddenError for student session', async () => {
    const { getSession } = await import('@/server/auth')

    const { userId } = await createStudent(testDb)
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { id: userId, name: 'Test', email: 'test@example.test', emailVerified: true },
      session: { id: 's', userId, expiresAt: new Date(Date.now() + 1000), token: 'tok' },
    } as never)

    const headers = new Headers()
    await expect(requireAdmin(headers)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('listPendingVerifications: student ctx → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    await expect(listPendingVerifications({ userId })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('listPendingVerifications: employer ctx → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    await expect(listPendingVerifications({ userId })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('listPendingVerifications: admin ctx → returns results', async () => {
    const adminCtx = await makeAdminCtx()
    const result = await listPendingVerifications(adminCtx)
    expect(Array.isArray(result)).toBe(true)
  })

  it('getCompanyForReview: student ctx → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    const { companyId } = await makeEmployerWithPending()
    await expect(getCompanyForReview({ userId }, companyId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('getCompanyForReview: employer ctx → ForbiddenError', async () => {
    const { userId } = await createEmployer(testDb)
    const { companyId } = await makeEmployerWithPending()
    await expect(getCompanyForReview({ userId }, companyId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('getCompanyForReview: admin ctx → returns company data', async () => {
    const adminCtx = await makeAdminCtx()
    const { companyId } = await makeEmployerWithPending()
    const company = await getCompanyForReview(adminCtx, companyId)
    expect(company).not.toBeNull()
    expect(company?.id).toBe(companyId)
  })
})
