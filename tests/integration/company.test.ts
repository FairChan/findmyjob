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
import { createCompany, updateCompany, getMyCompany } from '@/server/services/company'
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
