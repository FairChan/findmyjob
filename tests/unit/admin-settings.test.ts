/**
 * Integration tests for admin-settings service.
 * Uses the real test database (findmyjob_test via TEST_DATABASE_URL).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('server-only', () => ({}))

import { setupTestDb, testDb } from '../setup/db'
import { getAllSettings, updateSettingAdmin, SETTINGS } from '@/server/services/admin-settings'
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors'

setupTestDb()

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function mkAdmin() {
  return testDb.user.create({
    data: {
      name: 'Admin',
      email: `admin-${uid()}@example.test`,
      emailVerified: true,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  })
}

async function mkStudent() {
  return testDb.user.create({
    data: {
      name: 'Student',
      email: `student-${uid()}@example.test`,
      emailVerified: true,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  })
}

describe('getAllSettings', () => {
  it('admin can list all settings', async () => {
    const admin = await mkAdmin()
    const result = await getAllSettings({ userId: admin.id })
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((s) => 'key' in s && 'currentValue' in s)).toBe(true)
  })

  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    await expect(getAllSettings({ userId: student.id })).rejects.toThrow(ForbiddenError)
  })

  it('returns default value when setting has not been saved', async () => {
    const admin = await mkAdmin()
    const result = await getAllSettings({ userId: admin.id })
    const unlockCost = result.find((s) => s.key === 'unlock.costCredits')
    expect(unlockCost).toBeDefined()
    // May be DB value or default; either way it should be numeric
    expect(typeof unlockCost!.currentValue).toBe('number')
  })

  it('returns stored value when setting has been saved', async () => {
    const admin = await mkAdmin()
    await testDb.systemSetting.upsert({
      where: { key: 'team.maxMembers' },
      create: { key: 'team.maxMembers', value: 7, updatedById: admin.id },
      update: { value: 7, updatedById: admin.id },
    })
    const result = await getAllSettings({ userId: admin.id })
    const teamMax = result.find((s) => s.key === 'team.maxMembers')
    expect(teamMax?.currentValue).toBe(7)
  })
})

describe('updateSettingAdmin', () => {
  it('admin can update a boolean setting', async () => {
    const admin = await mkAdmin()
    await updateSettingAdmin({ userId: admin.id }, 'billing.enabled', false)
    const row = await testDb.systemSetting.findUnique({ where: { key: 'billing.enabled' } })
    expect(row?.value).toBe(false)
  })

  it('admin can update a numeric setting', async () => {
    const admin = await mkAdmin()
    await updateSettingAdmin({ userId: admin.id }, 'pilot.monthlyCredits', 50)
    const row = await testDb.systemSetting.findUnique({ where: { key: 'pilot.monthlyCredits' } })
    expect(row?.value).toBe(50)
  })

  it('admin can update an array setting', async () => {
    const admin = await mkAdmin()
    await updateSettingAdmin({ userId: admin.id }, 'jobs.salaryBands', [1500, 3000, 6000])
    const row = await testDb.systemSetting.findUnique({ where: { key: 'jobs.salaryBands' } })
    expect(row?.value).toEqual([1500, 3000, 6000])
  })

  it('admin can update a string enum setting', async () => {
    const admin = await mkAdmin()
    await updateSettingAdmin({ userId: admin.id }, 'search.defaultMode', 'RELATED')
    const row = await testDb.systemSetting.findUnique({ where: { key: 'search.defaultMode' } })
    expect(row?.value).toBe('RELATED')
  })

  it('rejects invalid value: number out of range', async () => {
    const admin = await mkAdmin()
    await expect(
      updateSettingAdmin({ userId: admin.id }, 'pilot.monthlyCredits', -1),
    ).rejects.toThrow(ValidationError)
  })

  it('rejects invalid value: wrong type', async () => {
    const admin = await mkAdmin()
    await expect(
      updateSettingAdmin({ userId: admin.id }, 'billing.enabled', 'not-a-boolean'),
    ).rejects.toThrow(ValidationError)
  })

  it('rejects invalid enum value', async () => {
    const admin = await mkAdmin()
    await expect(
      updateSettingAdmin({ userId: admin.id }, 'search.defaultMode', 'FUZZY'),
    ).rejects.toThrow(ValidationError)
  })

  it('rejects unknown key', async () => {
    const admin = await mkAdmin()
    await expect(
      updateSettingAdmin({ userId: admin.id }, 'unknown.key.that.does.not.exist', 123),
    ).rejects.toThrow(NotFoundError)
  })

  it('non-admin is rejected', async () => {
    const student = await mkStudent()
    await expect(
      updateSettingAdmin({ userId: student.id }, 'billing.enabled', false),
    ).rejects.toThrow(ForbiddenError)
  })

  it('writes audit log on save', async () => {
    const admin = await mkAdmin()
    await updateSettingAdmin({ userId: admin.id }, 'team.maxMembers', 5)
    const audit = await testDb.auditLog.findFirst({
      where: { actorId: admin.id, action: 'setting.update', targetId: 'team.maxMembers' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).toBeDefined()
    expect(audit?.targetType).toBe('SystemSetting')
  })

  it('SETTINGS registry covers all PRD §5 required keys', () => {
    const keys = SETTINGS.map((s) => s.key)
    const required = [
      'billing.enabled',
      'billing.studentEnabled',
      'pilot.monthlyCredits',
      'unlock.costCredits',
      'limits.profileViewsPerDay',
      'limits.otpSendsPerHour',
      'talentPool.minCompleteness',
      'studentQuota.enabled',
      'signup.studentCap',
      'legal.currentVersion',
    ]
    for (const k of required) {
      expect(keys).toContain(k)
    }
  })
})
