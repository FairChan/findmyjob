import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/server/lib/alert', () => ({ alert: vi.fn() }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent, createEmployer } from '../factories'
import { canSeeIdentity, canSeeIdentityMany } from '@/server/services/contact-access'
import { addBlockedCompany, getProfileViews, getUnlocks } from '@/server/services/privacy'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(() => clearSettingsCache())

async function unlockedStudent() {
  const student = await createStudent(testDb)
  const employer = await createEmployer(testDb)
  await testDb.company.update({
    where: { id: employer.companyId }, data: { verificationStatus: 'VERIFIED' },
  })
  await testDb.talentUnlock.create({
    data: {
      companyId: employer.companyId, studentId: student.profileId,
      unlockedById: employer.userId, source: 'CREDIT', creditsSpent: 1,
    },
  })
  return { student, employer }
}

describe('M4-T17: physical student deletion closes identity access', () => {
  it.each(['User', 'StudentProfile'] as const)('deleting the %s row makes both identity gates return false', async (entity) => {
    const { student, employer } = await unlockedStudent()
    expect(await canSeeIdentity(employer.companyId, student.profileId)).toBe(true)
    expect(await canSeeIdentityMany(employer.companyId, [student.profileId]))
      .toEqual(new Set([student.profileId]))

    if (entity === 'User') {
      await testDb.user.delete({ where: { id: student.userId } })
    } else {
      await testDb.studentProfile.delete({ where: { id: student.profileId } })
    }
    const remainingUser = await testDb.user.findUnique({ where: { id: student.userId } })
    expect(remainingUser === null).toBe(entity === 'User')

    expect(await testDb.studentProfile.findUnique({ where: { id: student.profileId } })).toBeNull()
    expect(await canSeeIdentity(employer.companyId, student.profileId)).toBe(false)
    expect(await canSeeIdentityMany(employer.companyId, [student.profileId])).toEqual(new Set())
  })
})

describe('M4-T17: blocking retains the student privacy history', () => {
  it('revokes company access but preserves its existing view and unlock for the student', async () => {
    const { student, employer } = await unlockedStudent()
    await testDb.profileView.create({
      data: {
        companyId: employer.companyId, studentId: student.profileId,
        viewerId: employer.userId,
      },
    })
    const viewsBefore = await getProfileViews({ userId: student.userId })
    const unlocksBefore = await getUnlocks({ userId: student.userId })
    expect(viewsBefore).toHaveLength(1)
    expect(unlocksBefore).toHaveLength(1)

    await addBlockedCompany({ userId: student.userId }, { companyId: employer.companyId })

    expect(await canSeeIdentity(employer.companyId, student.profileId)).toBe(false)
    expect(await getProfileViews({ userId: student.userId })).toEqual(viewsBefore)
    expect(await getUnlocks({ userId: student.userId })).toEqual(unlocksBefore)
  })
})
