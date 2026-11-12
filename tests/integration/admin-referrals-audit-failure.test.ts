import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))

vi.mock('@/server/services/audit', () => ({
  logAudit: vi.fn().mockRejectedValue(new Error('synthetic referral audit failure')),
}))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createStudent } from '../factories'
import { voidReferral } from '@/server/services/referrals'
import { getQuota } from '@/server/services/job-view-quota'
import { clearSettingsCache } from '@/server/services/settings'

setupTestDb()
beforeEach(() => clearSettingsCache())

describe('voidReferral audit atomicity', () => {
  it('rolls back the referral and effective quota when the audit fails', async () => {
    const admin = await createAdmin(testDb)
    const referrer = await createStudent(testDb)
    const ids: string[] = []
    for (let index = 0; index < 3; index++) {
      const invitee = await createStudent(testDb)
      const row = await testDb.referral.create({
        data: {
          referrerId: referrer.profileId, inviteeId: invitee.profileId,
          status: 'QUALIFIED', qualifiedAt: new Date('2026-11-01T00:00:00Z'),
        },
      })
      ids.push(row.id)
    }
    const before = await testDb.referral.findUnique({ where: { id: ids[0] } })
    expect(await getQuota(referrer.profileId)).toMatchObject({ qualified: 3, limit: 30 })

    await expect(voidReferral(ids[0], 'synthetic private reason', admin.userId))
      .rejects.toThrow('synthetic referral audit failure')

    expect(await testDb.referral.findUnique({ where: { id: ids[0] } })).toEqual(before)
    expect(await getQuota(referrer.profileId)).toMatchObject({ qualified: 3, limit: 30 })
    expect(await testDb.auditLog.count()).toBe(0)
  })
})
