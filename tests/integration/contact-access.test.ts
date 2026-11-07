/**
 * Integration tests for contact-access.ts (M4-T08).
 *
 * Covers:
 *  - canSeeIdentity: not unlocked, blocked, suspended/deleted, happy path
 *  - getContactForCompany: access control + decryption
 *  - TM-003: unlock → block/suspend/delete → access revoked
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupTestDb, testDb } from '../setup/db'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

setupTestDb()

import { createStudent, createEmployer } from '../factories'
import { canSeeIdentity, getContactForCompany } from '@/server/services/contact-access'
import { ForbiddenError } from '@/server/errors'
import { encryptField } from '@/server/lib/crypto'

// Make a student visible in the talent pool
async function makeVisible(profileId: string) {
  await testDb.studentProfile.update({
    where: { id: profileId },
    data: { visibility: 'PUBLIC', schoolVerifiedAt: new Date(), completeness: 80 },
  })
}

async function verifyCompany(companyId: string) {
  await testDb.company.update({
    where: { id: companyId },
    data: { verificationStatus: 'VERIFIED' },
  })
}

// Create a TalentUnlock record for the company+student
async function createUnlock(companyId: string, studentId: string, userId: string) {
  // Ensure wallet exists
  await testDb.creditWallet.upsert({
    where: { companyId },
    create: { companyId, balance: 10 },
    update: {},
  })
  return testDb.talentUnlock.create({
    data: { companyId, studentId, unlockedById: userId, source: 'CREDIT', creditsSpent: 1 },
  })
}

// Encrypt a contact field for a student
function encPhone(value: string, studentId: string) {
  return encryptField(value, `StudentContact.phone:${studentId}`)
}

describe('canSeeIdentity', () => {
  it('returns false when no TalentUnlock exists', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await makeVisible(profileId)

    const result = await canSeeIdentity(emp.companyId, profileId)
    expect(result).toBe(false)
  })

  it('returns true when TalentUnlock exists, student is active and not blocked', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    const result = await canSeeIdentity(emp.companyId, profileId)
    expect(result).toBe(true)
  })

  it('returns false when student has blocked the company (even if unlocked)', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)
    // Student blocks company after unlock
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId: emp.companyId } })

    const result = await canSeeIdentity(emp.companyId, profileId)
    expect(result).toBe(false)
  })

  it('returns false when student account is SUSPENDED', async () => {
    const { profileId, userId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)
    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })

    const result = await canSeeIdentity(emp.companyId, profileId)
    expect(result).toBe(false)
  })

  it('returns false when student account is DELETED', async () => {
    const { profileId, userId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)
    await testDb.user.update({ where: { id: userId }, data: { status: 'DELETED' } })

    const result = await canSeeIdentity(emp.companyId, profileId)
    expect(result).toBe(false)
  })

  it('returns false for a different company (no cross-company unlock)', async () => {
    const { profileId } = await createStudent(testDb)
    const empA = await createEmployer(testDb)
    const empB = await createEmployer(testDb)
    await verifyCompany(empA.companyId)
    await verifyCompany(empB.companyId)
    await makeVisible(profileId)
    await createUnlock(empA.companyId, profileId, empA.userId)

    // Company B has no unlock
    const result = await canSeeIdentity(empB.companyId, profileId)
    expect(result).toBe(false)
  })

  it('returns false when company verification is revoked (even if TalentUnlock exists)', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    // Revoke verification
    await testDb.company.update({ where: { id: emp.companyId }, data: { verificationStatus: 'REJECTED' } })

    const result = await canSeeIdentity(emp.companyId, profileId)
    expect(result).toBe(false)
  })
})

describe('getContactForCompany', () => {
  it('throws ForbiddenError when no TalentUnlock exists', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await makeVisible(profileId)

    await expect(getContactForCompany(emp.companyId, profileId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('returns decrypted contact when unlocked', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    // Write encrypted contact
    const encryptedPhone = encPhone('+60123456789', profileId)
    await testDb.studentContact.upsert({
      where: { studentId: profileId },
      create: { studentId: profileId, phone: encryptedPhone },
      update: { phone: encryptedPhone },
    })

    const contact = await getContactForCompany(emp.companyId, profileId)
    expect(contact.phone).toBe('+60123456789')
  })

  it('returns all-null contact when student has no contact record', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    const contact = await getContactForCompany(emp.companyId, profileId)
    expect(contact.phone).toBeNull()
    expect(contact.email).toBeNull()
    expect(contact.whatsapp).toBeNull()
    expect(contact.wechat).toBeNull()
    expect(contact.linkedinUrl).toBeNull()
  })

  it('throws ForbiddenError when student blocks company after unlock (TM-003)', async () => {
    const { profileId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)
    // Student blocks company
    await testDb.blockedCompany.create({ data: { studentId: profileId, companyId: emp.companyId } })

    await expect(getContactForCompany(emp.companyId, profileId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('throws ForbiddenError when student is suspended after unlock (TM-003)', async () => {
    const { profileId, userId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)
    await testDb.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } })

    await expect(getContactForCompany(emp.companyId, profileId)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('throws ForbiddenError when student is deleted after unlock (TM-003)', async () => {
    const { profileId, userId } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)
    await testDb.user.update({ where: { id: userId }, data: { status: 'DELETED' } })

    await expect(getContactForCompany(emp.companyId, profileId)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
