import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))

vi.mock('@/server/auth', () => ({ getSession: mocks.getSession, auth: {} }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('next/headers', () => ({
  headers: async () => new Headers({
    'x-real-ip': '192.0.2.44',
    'x-forwarded-for': '198.51.100.99',
  }),
}))
vi.mock('@/server/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { clearSettingsCache } from '@/server/services/settings'
import { setVisibilityAction } from '@/server/actions/privacy'

setupTestDb()

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache()
})

describe('M4-T17: visibility action writes a real audit for its authenticated owner', () => {
  it.each([true, false])('granted=%s records exact ownership, metadata and trusted IP', async (granted) => {
    const student = await createStudent(testDb, { email: 'visibility-owner@example.test' })
    const other = await createStudent(testDb, { email: 'visibility-other@example.test' })
    await testDb.studentProfile.update({
      where: { id: student.profileId }, data: { visibility: granted ? 'HIDDEN' : 'PUBLIC' },
    })
    await testDb.systemSetting.create({
      data: { key: 'legal.currentVersion', value: 'm4-t17-audit-test' },
    })
    if (granted) {
      await testDb.consent.createMany({
        data: (['TERMS', 'PRIVACY'] as const).map(type => ({
          userId: student.userId, type, granted: true, version: 'm4-t17-audit-test',
        })),
      })
    }
    mocks.getSession.mockResolvedValue({
      user: { id: student.userId },
      session: { createdAt: new Date(), twoFactorVerifiedAt: null },
    })

    // Deliberately include other-user identifiers. The real action/schema must
    // derive ownership from the authenticated session and strip these fields.
    const result = await setVisibilityAction({
      granted, userId: other.userId, studentId: other.profileId, ip: '203.0.113.55',
    })
    const visibility = granted ? 'PUBLIC' : 'HIDDEN'

    expect(result).toEqual({ ok: true, data: {} })
    expect(await testDb.studentProfile.findUnique({
      where: { id: student.profileId }, select: { visibility: true },
    })).toEqual({ visibility })
    expect(await testDb.studentProfile.findUnique({
      where: { id: other.profileId }, select: { visibility: true },
    })).toEqual({ visibility: 'HIDDEN' })
    expect(await testDb.auditLog.findMany({
      where: { action: 'student.visibility.change' },
      select: { actorId: true, action: true, targetType: true, targetId: true, metadata: true, ip: true },
    })).toEqual([{
      actorId: student.userId,
      action: 'student.visibility.change',
      targetType: 'StudentProfile',
      targetId: student.profileId,
      metadata: { granted, visibility },
      ip: '192.0.2.44',
    }])
    expect(await testDb.consent.findMany({
      where: { type: 'TALENT_POOL' },
      select: { userId: true, type: true, version: true, granted: true, ip: true },
    })).toEqual([{
      userId: student.userId, type: 'TALENT_POOL', version: 'm4-t17-audit-test',
      granted, ip: '192.0.2.44',
    }])
  })

  it('rejects an unauthenticated action without consent or audit writes', async () => {
    mocks.getSession.mockResolvedValue(null)

    expect(await setVisibilityAction({ granted: true })).toEqual({
      ok: false, code: 'FORBIDDEN',
    })
    expect(await testDb.auditLog.count({ where: { action: 'student.visibility.change' } })).toBe(0)
    expect(await testDb.consent.count({ where: { type: 'TALENT_POOL' } })).toBe(0)
  })
})
