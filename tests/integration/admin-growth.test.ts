import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createStudent } from '../factories'
import { getGrowthSummary } from '@/server/services/admin-growth'
import { clearSettingsCache } from '@/server/services/settings'
import { ForbiddenError } from '@/server/errors'

setupTestDb()
beforeEach(() => clearSettingsCache())

describe('admin growth summary', () => {
  it('counts only active verified students and defaults the signup cap to 3000', async () => {
    const admin = await createAdmin(testDb)
    await createStudent(testDb)
    await createStudent(testDb)
    await createStudent(testDb, { emailVerified: false })
    const suspended = await createStudent(testDb)
    const deleted = await createStudent(testDb)
    await testDb.user.update({ where: { id: suspended.userId }, data: { status: 'SUSPENDED' } })
    await testDb.user.update({ where: { id: deleted.userId }, data: { status: 'DELETED' } })
    await createEmployer(testDb)

    expect(await getGrowthSummary({ userId: admin.userId })).toEqual({
      studentCount: 2,
      signupCap: 3000,
    })
  })

  it('reads the configured signup cap', async () => {
    const admin = await createAdmin(testDb)
    await testDb.systemSetting.create({ data: { key: 'signup.studentCap', value: 42 } })
    expect(await getGrowthSummary({ userId: admin.userId })).toEqual({
      studentCount: 0,
      signupCap: 42,
    })
  })

  it.each([
    { role: 'STUDENT', status: 'ACTIVE' },
    { role: 'EMPLOYER', status: 'ACTIVE' },
    { role: 'ADMIN', status: 'SUSPENDED' },
    { role: 'ADMIN', status: 'DELETED' },
  ] as const)('rejects $role/$status from the persisted actor record', async (actor) => {
    const admin = await createAdmin(testDb)
    await testDb.user.update({ where: { id: admin.userId }, data: actor })
    await expect(getGrowthSummary({ userId: admin.userId })).rejects.toBeInstanceOf(ForbiddenError)
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it('rejects a missing actor', async () => {
    await expect(getGrowthSummary({ userId: 'missing-actor' })).rejects.toBeInstanceOf(ForbiddenError)
  })
})
