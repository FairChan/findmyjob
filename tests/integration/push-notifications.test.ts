/**
 * MA3-T01/T02: device tokens (encrypted, session-bound) and the push dispatcher (outbox scan of
 * committed notifications, generic PII-free text, preferences, quiet hours, at-most-once, revocation).
 * FCM is replaced by an injected sender; the database is real.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/server/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer, createStudent } from '../factories'
import {
  decryptDeviceToken,
  deviceTokenHash,
  getPushPreferences,
  registerDeviceToken,
  revokeDeviceToken,
  updatePushPreferences,
} from '@/server/services/device-tokens'
import { isQuietHourKL, runPushDispatch } from '@/server/jobs/push-notifications'
import type { FcmMessage, FcmResult } from '@/server/lib/fcm'

setupTestDb()

// 吉隆坡时间 14:00（UTC 06:00），不在静默时段
const NOON_KL = new Date('2026-11-18T06:00:00.000Z')
// 吉隆坡时间 02:00（UTC 18:00 前一天）
const NIGHT_KL = new Date('2026-11-17T18:00:00.000Z')

async function sessionFor(userId: string, expiresAt = new Date(Date.now() + 7 * 86400_000)) {
  return testDb.session.create({ data: { userId, token: randomUUID(), expiresAt } })
}

async function studentWithDevice(token = `fcm-${randomUUID()}-${'x'.repeat(40)}`, locale: 'zh' | 'en' = 'zh') {
  const s = await createStudent(testDb)
  const session = await sessionFor(s.userId)
  const device = await registerDeviceToken({ userId: s.userId, sessionId: session.id }, { token, appVersion: '0.1.0', locale })
  return { ...s, sessionId: session.id, deviceId: device.id, token }
}

async function notify(userId: string, type: string, payload: Record<string, unknown> = {}, createdAt = new Date(NOON_KL.getTime() - 30_000)) {
  return testDb.notification.create({ data: { userId, type, payload: payload as object, createdAt } })
}

function recorder(result: FcmResult = { outcome: 'ok' }) {
  const sent: FcmMessage[] = []
  const send = vi.fn(async (m: FcmMessage) => {
    sent.push(m)
    return result
  })
  return { sent, send }
}

describe('device tokens', () => {
  it('stores only ciphertext + sha256 hash and decrypts back', async () => {
    const d = await studentWithDevice()
    const row = await testDb.deviceToken.findUniqueOrThrow({ where: { id: d.deviceId } })
    expect(row.tokenEnc).not.toContain(d.token)
    expect(row.tokenHash).toBe(deviceTokenHash(d.token))
    expect(decryptDeviceToken(row)).toBe(d.token)
  })

  it('re-registering the same token on another account moves it there', async () => {
    const a = await studentWithDevice()
    const b = await createStudent(testDb)
    const sb = await sessionFor(b.userId)
    const again = await registerDeviceToken({ userId: b.userId, sessionId: sb.id }, { token: a.token, locale: 'en' })
    expect(again.id).toBe(a.deviceId)
    const row = await testDb.deviceToken.findUniqueOrThrow({ where: { id: a.deviceId } })
    expect(row.userId).toBe(b.userId)
    expect(await testDb.deviceToken.count()).toBe(1)
  })

  it('only the owner can revoke a token', async () => {
    const a = await studentWithDevice()
    const other = await createStudent(testDb)
    await expect(revokeDeviceToken({ userId: other.userId }, a.deviceId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await revokeDeviceToken({ userId: a.userId }, a.deviceId)
    expect((await testDb.deviceToken.findUniqueOrThrow({ where: { id: a.deviceId } })).revokedAt).not.toBeNull()
  })

  it('is deleted together with its session (sign-out, password change kick-out, account purge)', async () => {
    const a = await studentWithDevice()
    await testDb.session.delete({ where: { id: a.sessionId } })
    expect(await testDb.deviceToken.count({ where: { id: a.deviceId } })).toBe(0)
  })

  it('preferences default on (lock-screen details off) and update partially', async () => {
    const s = await createStudent(testDb)
    expect(await getPushPreferences({ userId: s.userId })).toEqual({
      applications: true, invitations: true, account: true, lockScreenDetails: false, quietHours: true,
    })
    const p = await updatePushPreferences({ userId: s.userId }, { invitations: false })
    expect(p.invitations).toBe(false)
    expect(p.applications).toBe(true)
  })
})

describe('push dispatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pushes a committed student notification once, with generic text and no payload data', async () => {
    const d = await studentWithDevice()
    const n = await notify(d.userId, 'application.status.changed', { companyName: 'Synthetic Sdn Bhd', jobTitle: 'Secret Role', to: 'INTERVIEW' })
    const { sent, send } = recorder()
    expect(await runPushDispatch({ now: NOON_KL, send })).toMatchObject({ sent: 1 })
    expect(sent).toHaveLength(1)
    const msg = sent[0]!
    expect(msg.token).toBe(d.token)
    expect(msg.body).toBe('你的投递有新进展，点开查看')
    expect(msg.data).toEqual({ type: 'application.status.changed', notificationId: n.id, route: '/applications' })
    const serialized = JSON.stringify(msg)
    for (const secret of ['Synthetic Sdn Bhd', 'Secret Role', 'INTERVIEW']) expect(serialized).not.toContain(secret)
    expect((await testDb.pushDelivery.findFirstOrThrow()).status).toBe('SENT')

    await runPushDispatch({ now: NOON_KL, send })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('uses the device locale', async () => {
    const d = await studentWithDevice(undefined, 'en')
    await notify(d.userId, 'invitation.received')
    const { sent, send } = recorder()
    await runPushDispatch({ now: NOON_KL, send })
    expect(sent[0]!.body).toBe('You have a new invitation. Tap to view.')
  })

  it('merges several pending notifications into one push', async () => {
    const d = await studentWithDevice()
    await notify(d.userId, 'application.status.changed')
    await notify(d.userId, 'invitation.received')
    await notify(d.userId, 'referral.qualified')
    const { sent, send } = recorder()
    expect(await runPushDispatch({ now: NOON_KL, send })).toMatchObject({ sent: 3 })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.body).toBe('你有 3 条新消息，点开查看')
    expect(sent[0]!.data.route).toBe('/notifications')
  })

  it('skips categories the student turned off', async () => {
    const d = await studentWithDevice()
    await updatePushPreferences({ userId: d.userId }, { invitations: false })
    await notify(d.userId, 'invitation.received')
    const { send } = recorder()
    expect(await runPushDispatch({ now: NOON_KL, send })).toMatchObject({ skipped: 1, sent: 0 })
    expect(send).not.toHaveBeenCalled()
  })

  it('defers during quiet hours and delivers afterwards', async () => {
    expect(isQuietHourKL(NIGHT_KL)).toBe(true)
    expect(isQuietHourKL(NOON_KL)).toBe(false)
    const d = await studentWithDevice()
    await notify(d.userId, 'application.status.changed', {}, new Date(NIGHT_KL.getTime() - 60_000))
    const { send } = recorder()
    expect(await runPushDispatch({ now: NIGHT_KL, send })).toMatchObject({ deferred: 1, sent: 0 })
    const morning = new Date('2026-11-18T00:30:00.000Z') // 08:30 KL
    expect(await runPushDispatch({ now: morning, send })).toMatchObject({ sent: 1 })
  })

  it('ignores non-student types, employers, read notifications, expired sessions and revoked devices', async () => {
    const d = await studentWithDevice()
    await notify(d.userId, 'talent.unlock')
    await notify(d.userId, 'application.status.changed').then((n) => testDb.notification.update({ where: { id: n.id }, data: { readAt: new Date() } }))
    const e = await createEmployer(testDb)
    const es = await sessionFor(e.userId)
    await registerDeviceToken({ userId: e.userId, sessionId: es.id }, { token: `emp-${randomUUID()}-${'y'.repeat(40)}`, locale: 'zh' })
    await notify(e.userId, 'application.status.changed')
    const expired = await createStudent(testDb)
    const xs = await sessionFor(expired.userId, new Date(NOON_KL.getTime() - 1000))
    await registerDeviceToken({ userId: expired.userId, sessionId: xs.id }, { token: `exp-${randomUUID()}-${'z'.repeat(40)}`, locale: 'zh' })
    await notify(expired.userId, 'application.status.changed')
    const revoked = await studentWithDevice()
    await revokeDeviceToken({ userId: revoked.userId }, revoked.deviceId)
    await notify(revoked.userId, 'application.status.changed')
    const { send } = recorder()
    await runPushDispatch({ now: NOON_KL, send })
    expect(send).not.toHaveBeenCalled()
  })

  it('revokes a token FCM reports as unregistered', async () => {
    const d = await studentWithDevice()
    await notify(d.userId, 'application.status.changed')
    const { send } = recorder({ outcome: 'permanent', code: 'UNREGISTERED' })
    expect(await runPushDispatch({ now: NOON_KL, send })).toMatchObject({ failed: 1 })
    expect((await testDb.deviceToken.findUniqueOrThrow({ where: { id: d.deviceId } })).revokedAt).not.toBeNull()
  })

  it('retries after a transient failure', async () => {
    const d = await studentWithDevice()
    await notify(d.userId, 'application.status.changed')
    const flaky = recorder({ outcome: 'transient', code: 'UNAVAILABLE' })
    expect(await runPushDispatch({ now: NOON_KL, send: flaky.send })).toMatchObject({ deferred: 1 })
    expect(await testDb.pushDelivery.count()).toBe(0)
    const ok = recorder()
    expect(await runPushDispatch({ now: NOON_KL, send: ok.send })).toMatchObject({ sent: 1 })
  })

  it('does nothing when FCM is not configured and no sender is injected', async () => {
    const d = await studentWithDevice()
    await notify(d.userId, 'application.status.changed')
    vi.stubEnv('FCM_PROJECT_ID', '')
    expect(await runPushDispatch({ now: NOON_KL })).toEqual({ sent: 0, skipped: 0, failed: 0, deferred: 0 })
    vi.unstubAllEnvs()
    expect(await testDb.pushDelivery.count()).toBe(0)
  })
})
