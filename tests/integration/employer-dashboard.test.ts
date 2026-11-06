/**
 * Integration tests for the employer dashboard page authz and data loading (M3-T06 fix).
 *
 * These tests call the page's default export directly against a real test DB so that
 * reverting to getMyCompany (which does not check isActive) would cause failures.
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

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn().mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFound: vi.fn().mockImplementation(() => {
    throw new Error('NOT_FOUND')
  }),
}))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children }: { children: unknown }) => children,
}))

vi.mock('@/lib/storage', () => ({
  deleteAllVersions: vi.fn().mockResolvedValue(undefined),
  getSignedUploadUrl: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
  getSignedDisplayUrl: vi.fn().mockResolvedValue('https://example.test/logo.png'),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer, createEmployerWithoutCompany } from '../factories'
import { ForbiddenError } from '@/server/errors'
import * as authMod from '@/server/auth'
import EmployerDashboardPage from '@/app/[locale]/e/page'
import { getVerificationInfo } from '@/server/services/verification'
import { requireCompanyMember } from '@/server/authz'

setupTestDb()

const noHeaders = new Headers()

function mockSession(userId: string | null, role: 'EMPLOYER' | 'STUDENT' = 'EMPLOYER') {
  if (userId === null) {
    vi.mocked(authMod.getSession).mockResolvedValue(null)
    return
  }
  vi.mocked(authMod.getSession).mockResolvedValue({
    user: {
      id: userId,
      name: '',
      email: '',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      image: null,
      role,
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

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Fix 1: page must use requireCompanyMember (not getMyCompany)
// ---------------------------------------------------------------------------

describe('employer dashboard page - inactive company', () => {
  it('member of inactive company is rejected with ForbiddenError', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { isActive: false } })
    mockSession(userId)
    // If the page reverted to getMyCompany (which does not check isActive),
    // this would succeed instead of throwing — the test would fail.
    await expect(
      EmployerDashboardPage({ params: Promise.resolve({ locale: 'zh' }) }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('employer without company is redirected to onboarding', async () => {
    const { userId } = await createEmployerWithoutCompany(testDb)
    mockSession(userId)
    await expect(
      EmployerDashboardPage({ params: Promise.resolve({ locale: 'zh' }) }),
    ).rejects.toThrow(/REDIRECT:\/zh\/e\/onboarding/)
  })
})

// ---------------------------------------------------------------------------
// Fix 2 & 3: banner role-awareness and rejection note
// ---------------------------------------------------------------------------

describe('banner data - RECRUITER access', () => {
  it('RECRUITER with REJECTED company can call requireCompanyMember', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'REJECTED' } })
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'RECRUITER' } })
    mockSession(userId)
    const ctx = await requireCompanyMember('RECRUITER', noHeaders)
    expect(ctx.userId).toBe(userId)
    expect(ctx.companyId).toBe(companyId)
    expect(ctx.role).toBe('RECRUITER')
  })

  it('RECRUITER gets rejection note via getVerificationInfo', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'REJECTED' } })
    await testDb.companyMember.updateMany({ where: { userId }, data: { role: 'RECRUITER' } })
    await testDb.companyVerification.create({
      data: {
        companyId,
        documentKeys: [`verifications/${companyId}/test.pdf`],
        status: 'REJECTED',
        submittedById: userId,
        reviewNote: 'SSM registration expired',
        reviewedAt: new Date(),
      },
    })
    mockSession(userId)
    const ctx = await requireCompanyMember('RECRUITER', noHeaders)
    const info = await getVerificationInfo(ctx)
    expect(info.latest?.reviewNote).toBe('SSM registration expired')
  })

  it('cross-company: cannot access another company rejection note', async () => {
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    await testDb.company.update({ where: { id: empB.companyId }, data: { verificationStatus: 'REJECTED' } })
    await testDb.companyVerification.create({
      data: {
        companyId: empB.companyId,
        documentKeys: [`verifications/${empB.companyId}/test.pdf`],
        status: 'REJECTED',
        submittedById: empB.userId,
        reviewNote: 'Company B secret note',
        reviewedAt: new Date(),
      },
    })
    // empA queries their own company - should not see empB's note
    mockSession(empA.userId)
    const ctxA = await requireCompanyMember('RECRUITER', noHeaders)
    expect(ctxA.companyId).toBe(empA.companyId)
    const infoA = await getVerificationInfo(ctxA)
    expect(infoA.latest).toBeNull()
  })
})
