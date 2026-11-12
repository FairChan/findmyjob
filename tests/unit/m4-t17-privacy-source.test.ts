import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  unlocks: vi.fn(),
}))

vi.mock('@/server/db', () => ({
  db: {
    studentProfile: { findUnique: mocks.profile },
    talentUnlock: { findMany: mocks.unlocks },
  },
}))
vi.mock('@/server/services/settings', () => ({ getSetting: vi.fn() }))
vi.mock('@/server/services/audit', () => ({ logAudit: vi.fn() }))

import { getUnlocks } from '@/server/services/privacy'

const USER_ID = 'clm4t17privacyuser00000001'
const STUDENT_ID = 'clm4t17privacystudent00001'
const COMPANY_ID = 'clm4t17privacycompany00001'
const unlockedAt = new Date('2026-11-05T01:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.profile.mockResolvedValue({ id: STUDENT_ID })
})

describe('M4-T17: privacy unlock records retain their source', () => {
  it.each(['CREDIT', 'APPLICATION', 'ADMIN'] as const)(
    'returns the exact %s source without exposing the whole database row',
    async (source) => {
      mocks.unlocks.mockResolvedValue([{
        id: 'private-unlock-row-id',
        companyId: COMPANY_ID,
        studentId: STUDENT_ID,
        source,
        creditsSpent: source === 'CREDIT' ? 1 : 0,
        unlockedById: 'private-operator-id',
        createdAt: unlockedAt,
        company: {
          legalName: 'Fictional Source Company',
          displayNameZh: null,
          displayNameEn: null,
        },
      }])

      expect(await getUnlocks({ userId: USER_ID })).toEqual([{
        companyId: COMPANY_ID,
        companyName: 'Fictional Source Company',
        unlockedAt,
        source,
      }])
      expect(mocks.unlocks).toHaveBeenCalledWith(expect.objectContaining({
        where: { studentId: STUDENT_ID },
      }))
    },
  )
})
