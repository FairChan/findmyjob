/**
 * Integration tests: canSeeIdentity/canSeeIdentityMany is the sole gate for identity reveal (M4-T18).
 *
 * These tests mock the contact-access module so canSeeIdentityMany returns an empty Set,
 * then verify that all three services return masked name and no contact even when a real
 * TalentUnlock row exists in the DB.
 *
 * Any reversion of the services to `unlocks.length > 0` will cause these tests to fail
 * because unlocks ARE present in the DB, but canSeeIdentityMany returns an empty Set.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

// Mock canSeeIdentity and canSeeIdentityMany to always refuse identity reveal.
// Real module's other exports (getContactForCompany, etc.) pass through.
vi.mock('@/server/services/contact-access', async (orig) => ({
  ...(await orig()),
  canSeeIdentity: vi.fn().mockResolvedValue(false),
  canSeeIdentityMany: vi.fn().mockResolvedValue(new Set<string>()),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import { searchTalents } from '@/server/services/talent-search'
import { createFolder, addToFolder, getFolderItems } from '@/server/services/talent-folders'
import { viewTalentProfile } from '@/server/services/talent-view'
import { maskName } from '@/lib/mask-name'
import * as contactAccess from '@/server/services/contact-access'

setupTestDb()

beforeEach(() => {
  vi.mocked(contactAccess.canSeeIdentity).mockResolvedValue(false)
  vi.mocked(contactAccess.canSeeIdentityMany).mockResolvedValue(new Set<string>())
})

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

describe('canSeeIdentityMany gate: TalentUnlock present but gate returns empty → masked result', () => {
  it('searchTalents: TalentUnlock exists but canSeeIdentityMany returns empty → card name is masked', async () => {
    const { profileId, name } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    // Real TalentUnlock row exists — but canSeeIdentityMany mock returns empty Set
    await createUnlock(emp.companyId, profileId, emp.userId)

    const result = await searchTalents({ userId: emp.userId, companyId: emp.companyId }, {})
    expect(result.students.length).toBeGreaterThan(0)
    const card = result.students.find((s) => s.id === profileId)
    expect(card).toBeDefined()
    expect(card!.name).not.toBe(name)
    expect(card!.name).toBe(maskName(name))
    expect(card!.unlocked).toBe(false)
  })

  it('searchTalents keyword: canSeeIdentityMany returns empty → keyword result name is masked', async () => {
    const { profileId, name } = await createStudent(testDb, { completeness: 80 })
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    // Add a distinguishable skill keyword so the keyword search can find this student
    await testDb.studentProfile.update({
      where: { id: profileId },
      data: { skills: ['ReactJS', 'TypeScript'] },
    })

    const result = await searchTalents({ userId: emp.userId, companyId: emp.companyId }, { keyword: 'ReactJS' })
    const card = result.students.find((s) => s.id === profileId)
    expect(card).toBeDefined()
    expect(card!.name).toBe(maskName(name))
    expect(card!.unlocked).toBe(false)
  })

  it('getFolderItems: TalentUnlock exists but canSeeIdentityMany returns empty → card name is masked', async () => {
    const { profileId, name } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    const folder = await createFolder({ userId: emp.userId, companyId: emp.companyId }, { name: 'Gate Test' })
    await addToFolder({ userId: emp.userId, companyId: emp.companyId }, { folderId: folder.id, studentId: profileId })

    const { items } = await getFolderItems({ userId: emp.userId, companyId: emp.companyId }, folder.id)
    expect(items.length).toBe(1)
    expect(items[0].card.name).not.toBe(name)
    expect(items[0].card.name).toBe(maskName(name))
    expect(items[0].card.unlocked).toBe(false)
  })

  it('viewTalentProfile: TalentUnlock exists but canSeeIdentity returns false → masked name, contact=null', async () => {
    const { profileId, name } = await createStudent(testDb)
    const emp = await createEmployer(testDb)
    await verifyCompany(emp.companyId)
    await makeVisible(profileId)
    await createUnlock(emp.companyId, profileId, emp.userId)

    const detail = await viewTalentProfile({ userId: emp.userId, companyId: emp.companyId }, profileId)
    expect(detail.name).not.toBe(name)
    expect(detail.name).toBe(maskName(name))
    expect(detail.unlocked).toBe(false)
    expect(detail.contact).toBeNull()
  })
})
