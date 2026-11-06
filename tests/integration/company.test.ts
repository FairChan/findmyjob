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
import { ForbiddenError, ValidationError } from '@/server/errors'

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

  it('rejects employer who already has a company → ValidationError', async () => {
    const { userId } = await createEmployer(testDb)
    await expect(createCompany({ userId }, { legalName: 'Second Sdn Bhd' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects duplicate SSM registration number → ValidationError', async () => {
    const { userId: uid1 } = await createEmployerWithoutCompany(testDb)
    const { userId: uid2 } = await createEmployerWithoutCompany(testDb)
    await createCompany({ userId: uid1 }, { legalName: 'First Sdn Bhd', ssmRegNo: '1234567-X' })
    await expect(
      createCompany({ userId: uid2 }, { legalName: 'Second Sdn Bhd', ssmRegNo: '1234567-X' })
    ).rejects.toBeInstanceOf(ValidationError)
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

  it('rejects duplicate SSM for a different company → ValidationError', async () => {
    const { userId: uid1, companyId: cid1 } = await createEmployer(testDb)
    const { userId: uid2, companyId: cid2 } = await createEmployer(testDb)
    await updateCompany({ userId: uid1, companyId: cid1, role: 'OWNER' }, { legalName: 'Co1', ssmRegNo: 'SSM-001' })
    await expect(
      updateCompany({ userId: uid2, companyId: cid2, role: 'OWNER' }, { legalName: 'Co2', ssmRegNo: 'SSM-001' })
    ).rejects.toBeInstanceOf(ValidationError)
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
    expect((failures[0] as PromiseRejectedResult).reason).toBeInstanceOf(ValidationError)
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
