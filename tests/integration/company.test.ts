/**
 * Integration tests for company service (M3-T01).
 * Tests createCompany, updateCompany, getMyCompany against a real DB.
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

// deleteAllVersions is a no-op in tests
vi.mock('@/lib/storage', () => ({
  deleteAllVersions: vi.fn().mockResolvedValue(undefined),
  getSignedUploadUrl: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer, createEmployerWithoutCompany } from '../factories'
import { createCompany, updateCompany, getMyCompany, isOwnLogoKey } from '@/server/services/company'
import { deleteAllVersions } from '@/lib/storage'
import { AppError, ForbiddenError } from '@/server/errors'

setupTestDb()

describe('createCompany', () => {
  it('creates company and OWNER member for employer', async () => {
    const { userId } = await createEmployerWithoutCompany(testDb)
    const company = await createCompany({ userId }, { legalName: 'Test Sdn Bhd' })
    expect(company.legalName).toBe('Test Sdn Bhd')
    const member = await testDb.companyMember.findFirst({ where: { userId } })
    expect(member?.role).toBe('OWNER')
    expect(member?.companyId).toBe(company.id)
  })

  it('writes audit log on create', async () => {
    const { userId } = await createEmployerWithoutCompany(testDb)
    const company = await createCompany({ userId }, { legalName: 'AuditCo Sdn Bhd' })
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.create', targetId: company.id },
    })
    expect(audit).not.toBeNull()
    expect(audit?.actorId).toBe(userId)
  })

  it('rejects student → ForbiddenError', async () => {
    const { userId } = await createStudent(testDb)
    await expect(createCompany({ userId }, { legalName: 'No Sdn Bhd' })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects employer who already has a company → AppError ALREADY_MEMBER', async () => {
    const { userId } = await createEmployer(testDb)
    const err = await createCompany({ userId }, { legalName: 'Second Sdn Bhd' }).catch(e => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('ALREADY_MEMBER')
  })

  it('rejects duplicate SSM registration number → AppError SSM_DUPLICATE', async () => {
    const { userId: uid1 } = await createEmployerWithoutCompany(testDb)
    const { userId: uid2 } = await createEmployerWithoutCompany(testDb)
    await createCompany({ userId: uid1 }, { legalName: 'First Sdn Bhd', ssmRegNo: '1234567-X' })
    const err = await createCompany({ userId: uid2 }, { legalName: 'Second Sdn Bhd', ssmRegNo: '1234567-X' }).catch(e => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('SSM_DUPLICATE')
  })
})

describe('updateCompany', () => {
  it('updates company fields', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    const updated = await updateCompany(
      { userId, companyId, role: 'OWNER' },
      { legalName: 'Updated Sdn Bhd', city: 'Kuala Lumpur' }
    )
    expect(updated.legalName).toBe('Updated Sdn Bhd')
    expect(updated.city).toBe('Kuala Lumpur')
  })

  it('writes audit log on update', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await updateCompany({ userId, companyId, role: 'OWNER' }, { legalName: 'AuditUpdate Sdn Bhd' })
    const audit = await testDb.auditLog.findFirst({
      where: { action: 'company.update', targetId: companyId },
    })
    expect(audit).not.toBeNull()
  })

  it('rejects duplicate SSM for a different company → AppError SSM_DUPLICATE', async () => {
    const { userId: uid1, companyId: cid1 } = await createEmployer(testDb)
    const { userId: uid2, companyId: cid2 } = await createEmployer(testDb)
    await updateCompany({ userId: uid1, companyId: cid1, role: 'OWNER' }, { legalName: 'Co1', ssmRegNo: 'SSM-001' })
    const err = await updateCompany({ userId: uid2, companyId: cid2, role: 'OWNER' }, { legalName: 'Co2', ssmRegNo: 'SSM-001' }).catch(e => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('SSM_DUPLICATE')
  })

  it('allows keeping the same SSM number on update', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await updateCompany({ userId, companyId, role: 'OWNER' }, { legalName: 'Co', ssmRegNo: 'SSM-SAME' })
    await expect(
      updateCompany({ userId, companyId, role: 'OWNER' }, { legalName: 'Co Updated', ssmRegNo: 'SSM-SAME' })
    ).resolves.not.toThrow()
  })
})

describe('updateCompany logoKey ownership', () => {
  it('rejects logoKey belonging to another company → ForbiddenError, deleteAllVersions not called', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    const { companyId: otherCompanyId } = await createEmployer(testDb)
    const foreignKey = `logos/${otherCompanyId}/some-uuid.png`
    const mockDelete = vi.mocked(deleteAllVersions)
    mockDelete.mockClear()

    await expect(
      updateCompany({ userId, companyId, role: 'OWNER' }, { legalName: 'Co', logoKey: foreignKey })
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('accepts logoKey belonging to own company', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    const ownKey = `logos/${companyId}/some-uuid.png`
    await expect(
      updateCompany({ userId, companyId, role: 'OWNER' }, { legalName: 'Co', logoKey: ownKey })
    ).resolves.not.toThrow()
  })
})

describe('isOwnLogoKey', () => {
  it('returns true for key with correct company prefix', () => {
    expect(isOwnLogoKey('cmp123', 'logos/cmp123/abc.png')).toBe(true)
  })

  it('returns false for key with different company prefix', () => {
    expect(isOwnLogoKey('cmp123', 'logos/cmp456/abc.png')).toBe(false)
  })

  it('returns false for key with no logos prefix', () => {
    expect(isOwnLogoKey('cmp123', 'verifications/cmp123/doc.pdf')).toBe(false)
  })

  it('returns false for empty key', () => {
    expect(isOwnLogoKey('cmp123', '')).toBe(false)
  })
})

// Page-layer logo attribution: getPublicCompany + isOwnLogoKey combination
// Verifies the guard used in companies/[id]/page.tsx works for tampered logoKeys
describe('public page logo attribution guard (page-layer)', () => {
  it('isOwnLogoKey returns false when company has logoKey from another company — page would not render that logo', async () => {
    const { companyId: otherCompanyId } = await createEmployer(testDb)
    const { userId, companyId } = await createEmployer(testDb)
    // Directly set a logoKey that belongs to another company (simulates DB tampering or bug)
    const foreignLogoKey = `logos/${otherCompanyId}/stolen.png`
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', isActive: true, logoKey: foreignLogoKey },
    })

    const { getPublicCompany } = await import('@/server/services/company')
    const company = await getPublicCompany(companyId)
    expect(company).not.toBeNull()
    // Page guard: isOwnLogoKey(company.id, company.logoKey) must be false for this key
    expect(isOwnLogoKey(company!.id, company!.logoKey!)).toBe(false)
    void userId
  })

  it('isOwnLogoKey returns true when logoKey belongs to the same company — page would render logo', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    const ownLogoKey = `logos/${companyId}/logo.png`
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', isActive: true, logoKey: ownLogoKey },
    })

    const { getPublicCompany } = await import('@/server/services/company')
    const company = await getPublicCompany(companyId)
    expect(company).not.toBeNull()
    expect(isOwnLogoKey(company!.id, company!.logoKey!)).toBe(true)
    void userId
  })
})

describe('createCompany SSM normalization', () => {
  it('trims and uppercases SSM number', async () => {
    const { userId } = await createEmployerWithoutCompany(testDb)
    const co = await createCompany({ userId }, { legalName: 'Norm Co Sdn Bhd', ssmRegNo: '  abc-123  ' })
    expect(co.ssmRegNo).toBe('ABC-123')
  })

  it('duplicate SSM after normalization → SSM_DUPLICATE code', async () => {
    const { userId: uid1 } = await createEmployerWithoutCompany(testDb)
    const { userId: uid2 } = await createEmployerWithoutCompany(testDb)
    await createCompany({ userId: uid1 }, { legalName: 'Co A Sdn Bhd', ssmRegNo: 'SSM-NORM' })
    const err = await createCompany({ userId: uid2 }, { legalName: 'Co B Sdn Bhd', ssmRegNo: 'ssm-norm' }).catch(e => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('SSM_DUPLICATE')
  })

  it('already-member error has ALREADY_MEMBER code', async () => {
    const { userId } = await createEmployer(testDb)
    const err = await createCompany({ userId }, { legalName: 'Second Co' }).catch(e => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('ALREADY_MEMBER')
  })
})

describe('updateCompany SSM normalization', () => {
  it('trims and uppercases SSM number on update', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    const updated = await updateCompany({ userId, companyId, role: 'OWNER' }, { legalName: 'Co', ssmRegNo: '  ssm-upd-1  ' })
    expect(updated.ssmRegNo).toBe('SSM-UPD-1')
  })
})

describe('updateCompany website validation', () => {
  it('rejects website without http/https protocol → VALIDATION_ERROR', async () => {
    const { createCompanySchema } = await import('@/server/services/company')
    const updateSchema = createCompanySchema.extend({ logoKey: (await import('zod')).z.string().optional() })
    const result = updateSchema.safeParse({ legalName: 'Test Co', website: 'ftp://bad.example.com' })
    expect(result.success).toBe(false)
  })

  it('accepts website with https protocol', async () => {
    const { createCompanySchema } = await import('@/server/services/company')
    const result = createCompanySchema.safeParse({ legalName: 'Test Co', website: 'https://example.com' })
    expect(result.success).toBe(true)
  })

  it('accepts website with http protocol', async () => {
    const { createCompanySchema } = await import('@/server/services/company')
    const result = createCompanySchema.safeParse({ legalName: 'Test Co', website: 'http://example.com' })
    expect(result.success).toBe(true)
  })
})

describe('updateCompany identity lock', () => {
  async function makeVerifiedCompany() {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', legalName: 'Verified Co Sdn Bhd', ssmRegNo: 'SSM-V1' },
    })
    return { userId, companyId }
  }

  it('VERIFIED company: changing legalName → AppError IDENTITY_LOCKED', async () => {
    const { userId, companyId } = await makeVerifiedCompany()
    const { AppError } = await import('@/server/errors')
    const err = await updateCompany(
      { userId, companyId, role: 'OWNER' },
      { legalName: 'Hijacked Sdn Bhd' },
    ).catch(e => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as InstanceType<typeof AppError>).code).toBe('IDENTITY_LOCKED')
  })

  it('VERIFIED company: changing displayNameZh → AppError IDENTITY_LOCKED', async () => {
    const { userId, companyId } = await makeVerifiedCompany()
    const { AppError } = await import('@/server/errors')
    const err = await updateCompany(
      { userId, companyId, role: 'OWNER' },
      { legalName: 'Verified Co Sdn Bhd', displayNameZh: '被改了' },
    ).catch(e => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as InstanceType<typeof AppError>).code).toBe('IDENTITY_LOCKED')
  })

  it('PENDING company: changing legalName → AppError IDENTITY_LOCKED', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'PENDING', legalName: 'Pending Co Sdn Bhd' } })
    const { AppError } = await import('@/server/errors')
    const err = await updateCompany(
      { userId, companyId, role: 'OWNER' },
      { legalName: 'Changed Name' },
    ).catch(e => e)
    expect(err).toBeInstanceOf(AppError)
    expect((err as InstanceType<typeof AppError>).code).toBe('IDENTITY_LOCKED')
  })

  it('VERIFIED company: changing only description (identity fields same) → allowed', async () => {
    const { userId, companyId } = await makeVerifiedCompany()
    // Full form submit: include unchanged identity fields
    await expect(
      updateCompany(
        { userId, companyId, role: 'OWNER' },
        { legalName: 'Verified Co Sdn Bhd', ssmRegNo: 'SSM-V1', description: 'New description' },
      ),
    ).resolves.not.toThrow()
  })

  it('VERIFIED company: same identity fields in full form submit → allowed', async () => {
    const { userId, companyId } = await makeVerifiedCompany()
    await expect(
      updateCompany(
        { userId, companyId, role: 'OWNER' },
        { legalName: 'Verified Co Sdn Bhd', ssmRegNo: 'SSM-V1', city: 'Kuala Lumpur' },
      ),
    ).resolves.not.toThrow()
  })

  it('UNSUBMITTED company: can change identity fields', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await expect(
      updateCompany({ userId, companyId, role: 'OWNER' }, { legalName: 'New Name Sdn Bhd' }),
    ).resolves.not.toThrow()
  })

  it('REJECTED company: can change identity fields', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.company.update({ where: { id: companyId }, data: { verificationStatus: 'REJECTED', legalName: 'Old Name Sdn Bhd' } })
    await expect(
      updateCompany({ userId, companyId, role: 'OWNER' }, { legalName: 'New Name After Reject' }),
    ).resolves.not.toThrow()
  })
})

describe('concurrent createCompany', () => {
  it('only one succeeds when two requests race for the same user', async () => {
    const { userId } = await createEmployerWithoutCompany(testDb)
    const results = await Promise.allSettled([
      createCompany({ userId }, { legalName: 'Race A Sdn Bhd' }),
      createCompany({ userId }, { legalName: 'Race B Sdn Bhd' }),
    ])
    const successes = results.filter(r => r.status === 'fulfilled')
    const failures = results.filter(r => r.status === 'rejected')
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    const failReason = (failures[0] as PromiseRejectedResult).reason as AppError
    expect(failReason).toBeInstanceOf(AppError)
    expect(['ALREADY_MEMBER', 'SSM_DUPLICATE']).toContain(failReason.code)
    const count = await testDb.companyMember.count({ where: { userId } })
    expect(count).toBe(1)
  })
})

describe('getMyCompany', () => {
  it('returns company for a member', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    const co = await getMyCompany({ userId })
    expect(co?.id).toBe(companyId)
  })

  it('returns null when no membership exists', async () => {
    const { userId } = await createEmployerWithoutCompany(testDb)
    const co = await getMyCompany({ userId })
    expect(co).toBeNull()
  })
})
