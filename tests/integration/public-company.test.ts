/**
 * Integration tests for the public company profile service (M3-T05).
 */
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { getPublicCompany } from '@/server/services/company'

setupTestDb()

describe('getPublicCompany', () => {
  it('returns null for an unverified company', async () => {
    const { companyId } = await createEmployer(testDb)
    // createEmployer sets verificationStatus: UNSUBMITTED by default
    const result = await getPublicCompany(companyId)
    expect(result).toBeNull()
  })

  it('returns null for a PENDING company', async () => {
    const { companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'PENDING' },
    })
    const result = await getPublicCompany(companyId)
    expect(result).toBeNull()
  })

  it('returns null for a REJECTED company', async () => {
    const { companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'REJECTED' },
    })
    const result = await getPublicCompany(companyId)
    expect(result).toBeNull()
  })

  it('returns null for a VERIFIED but inactive company', async () => {
    const { companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', isActive: false },
    })
    const result = await getPublicCompany(companyId)
    expect(result).toBeNull()
  })

  it('returns company data for a VERIFIED active company', async () => {
    const { companyId } = await createEmployer(testDb, { legalName: 'Acme Sdn Bhd' })
    await testDb.company.update({
      where: { id: companyId },
      data: {
        verificationStatus: 'VERIFIED',
        isActive: true,
        isFoundingPartner: false,
        description: 'A great company',
        website: 'https://acme.example.com',
      },
    })
    const result = await getPublicCompany(companyId)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(companyId)
    expect(result!.legalName).toBe('Acme Sdn Bhd')
    expect(result!.isFoundingPartner).toBe(false)
  })

  it('exposes isFoundingPartner flag', async () => {
    const { companyId } = await createEmployer(testDb)
    await testDb.company.update({
      where: { id: companyId },
      data: { verificationStatus: 'VERIFIED', isActive: true, isFoundingPartner: true },
    })
    const result = await getPublicCompany(companyId)
    expect(result?.isFoundingPartner).toBe(true)
  })

  it('returns null for a non-existent id', async () => {
    const result = await getPublicCompany('nonexistent-id-00000000')
    expect(result).toBeNull()
  })
})
