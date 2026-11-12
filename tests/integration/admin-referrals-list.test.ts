import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createStudent } from '../factories'
import { listReferrals } from '@/server/services/referrals'
import { ForbiddenError, ValidationError } from '@/server/errors'

setupTestDb()

describe('admin referral listing', () => {
  it('paginates tied timestamps without duplicates or omissions, with bounded pages', async () => {
    const admin = await createAdmin(testDb)
    const referrer = await createStudent(testDb)
    const createdAt = new Date('2026-11-01T00:00:00Z')
    const ids: string[] = []
    for (let index = 0; index < 52; index++) {
      const invitee = await createStudent(testDb)
      const row = await testDb.referral.create({
        data: { referrerId: referrer.profileId, inviteeId: invitee.profileId, createdAt },
      })
      ids.push(row.id)
    }
    const first = await listReferrals({ userId: admin.userId }, {})
    expect(first.items).toHaveLength(25)
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await listReferrals({ userId: admin.userId }, { cursor: first.nextCursor! })
    expect(second.items).toHaveLength(25)
    expect(second.nextCursor).toEqual(expect.any(String))
    const third = await listReferrals({ userId: admin.userId }, { cursor: second.nextCursor! })
    expect(third.items).toHaveLength(2)
    expect(third.nextCursor).toBeNull()
    expect([...first.items, ...second.items, ...third.items].map((row) => row.id).sort()).toEqual(ids.sort())
    expect((await listReferrals({ userId: admin.userId }, { limit: 50 })).items).toHaveLength(50)
    expect(Object.keys(first.items[0]).sort()).toEqual([
      'id', 'referrerId', 'inviteeId', 'referrerName', 'inviteeName',
      'status', 'qualifiedAt', 'voidReason', 'createdAt',
    ].sort())
  })

  it('combines the status and referrer filters', async () => {
    const admin = await createAdmin(testDb)
    const first = await createStudent(testDb)
    const second = await createStudent(testDb)
    const invitees = await Promise.all(Array.from({ length: 3 }, () => createStudent(testDb)))
    const match = await testDb.referral.create({
      data: { referrerId: first.profileId, inviteeId: invitees[0].profileId, status: 'VOID', voidReason: 'synthetic' },
    })
    await testDb.referral.create({
      data: { referrerId: first.profileId, inviteeId: invitees[1].profileId, status: 'QUALIFIED' },
    })
    await testDb.referral.create({
      data: { referrerId: second.profileId, inviteeId: invitees[2].profileId, status: 'VOID' },
    })
    const page = await listReferrals({ userId: admin.userId }, { status: 'VOID', referrerId: first.profileId })
    expect(page.items.map((row) => row.id)).toEqual([match.id])
    expect(page.nextCursor).toBeNull()
  })

  it.each([
    { role: 'STUDENT', status: 'ACTIVE' },
    { role: 'EMPLOYER', status: 'ACTIVE' },
    { role: 'ADMIN', status: 'SUSPENDED' },
    { role: 'ADMIN', status: 'DELETED' },
  ] as const)('rejects $role/$status', async (actor) => {
    const admin = await createAdmin(testDb)
    await testDb.user.update({ where: { id: admin.userId }, data: actor })
    await expect(listReferrals({ userId: admin.userId }, {})).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects a missing actor', async () => {
    await expect(listReferrals({ userId: 'missing-actor' }, {})).rejects.toBeInstanceOf(ForbiddenError)
  })

  it.each([{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { cursor: 'malformed-cursor' }])(
    'rejects invalid pagination %j', async (input) => {
      const admin = await createAdmin(testDb)
      await expect(listReferrals({ userId: admin.userId }, input)).rejects.toBeInstanceOf(ValidationError)
    },
  )
})
