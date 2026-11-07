/**
 * Integration tests for school-verification service.
 * Uses the real test DB; mocks only the email provider and settings.
 *
 * Fix 1 (M2-T12): OTP brute-force prevention via atomic hitBucket
 * Fix 5.3 (M2-T12): OTP 10-minute expiry and 30-minute lockout expiry assertions
 */
import { vi, describe, it, expect } from 'vitest'
import crypto from 'crypto'

vi.mock('@/env', () => ({ env: {} }))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/email', () => ({
  createEmailProvider: () => ({ sendEmail: mockSendEmail }),
}))

const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

import { setupTestDb, testDb } from '../setup/db'
import { createStudent } from '../factories'
import { requestSchoolOtp, verifySchoolOtp } from '@/server/services/school-verification'
import { ValidationError, RateLimitedError } from '@/server/errors'

setupTestDb()

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex')
}

async function seedSchool() {
  return testDb.school.create({
    data: {
      nameZh: '测试大学',
      nameEn: 'Test University',
      emailDomains: ['test.edu.my'],
      active: true,
    },
  })
}

function setupSettingsMocks() {
  mockGetSetting.mockImplementation((key: string, def: unknown) => {
    const map: Record<string, unknown> = {
      'limits.otpSendsPerHour': 20,
      'limits.otpSendsPerEmailPerDay': 20,
    }
    return Promise.resolve(map[key] ?? def)
  })
}

describe('verifySchoolOtp — OTP expiry assertions (M2-T12 fix 5.3)', () => {
  it('requestSchoolOtp creates a Verification with expiresAt ~10 minutes from now', async () => {
    setupSettingsMocks()
    const school = await seedSchool()
    const student = await createStudent(testDb)
    const ctx = { userId: student.userId }

    const before = Date.now()
    await requestSchoolOtp(ctx, { schoolId: school.id, schoolEmail: 'student@test.edu.my' })

    const row = await testDb.verification.findFirst({
      where: { identifier: `school-otp:${student.userId}` },
    })
    expect(row).not.toBeNull()
    const expiryMs = row!.expiresAt.getTime()
    expect(expiryMs).toBeGreaterThan(before + 9 * 60 * 1000)
    expect(expiryMs).toBeLessThan(before + 11 * 60 * 1000)
  })

  it('lock record created after bucket exhaustion has expiresAt ~30 minutes from now', async () => {
    setupSettingsMocks()
    const school = await seedSchool()
    const student = await createStudent(testDb)
    const ctx = { userId: student.userId }

    // Directly create an OTP record with a known hash
    const otp = '999999'
    await testDb.verification.create({
      data: {
        identifier: `school-otp:${student.userId}`,
        value: JSON.stringify({ hash: hashOtp(otp), schoolId: school.id, schoolEmail: 'student@test.edu.my' }),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    })

    // Make 6 wrong attempts — 5th should still pass hitBucket, 6th triggers lockout
    const wrongOtp = '000000'
    for (let i = 0; i < 5; i++) {
      await expect(verifySchoolOtp(ctx, { otp: wrongOtp })).rejects.toThrow(ValidationError)
    }

    const before = Date.now()
    // 6th attempt triggers lockout
    await expect(verifySchoolOtp(ctx, { otp: wrongOtp })).rejects.toThrow(RateLimitedError)

    const lock = await testDb.verification.findFirst({
      where: { identifier: `school-otp-lock:${student.userId}` },
    })
    expect(lock).not.toBeNull()
    const lockExpiry = lock!.expiresAt.getTime()
    expect(lockExpiry).toBeGreaterThan(before + 29 * 60 * 1000)
    expect(lockExpiry).toBeLessThan(before + 31 * 60 * 1000)
  })
})

describe('verifySchoolOtp — concurrent brute-force prevention (M2-T12 fix 1)', () => {
  it('20 parallel wrong guesses: at most 5 get through to comparison, rest are rate-limited', async () => {
    setupSettingsMocks()
    const school = await seedSchool()
    const student = await createStudent(testDb)
    const ctx = { userId: student.userId }

    // Create OTP record with known hash
    const correctOtp = '123456'
    await testDb.verification.create({
      data: {
        identifier: `school-otp:${student.userId}`,
        value: JSON.stringify({ hash: hashOtp(correctOtp), schoolId: school.id, schoolEmail: 'student@test.edu.my' }),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    })

    // Send 20 concurrent wrong guesses
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => verifySchoolOtp(ctx, { otp: '000000' }))
    )

    // Only count otp_invalid ValidationErrors (not otp_expired_or_not_found which
    // happens after the lockout deletes the OTP record — those don't consume a bucket slot)
    const validationErrors = results.filter(
      (r) =>
        r.status === 'rejected' &&
        r.reason instanceof ValidationError &&
        r.reason.message === 'otp_invalid',
    ).length
    const rateLimitErrors = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof RateLimitedError,
    ).length

    // After lockout, the OTP record is deleted; subsequent requests get otp_expired_or_not_found
    // which is also a valid rejection (the OTP is gone) — count them together with rateLimitErrors.
    const expiredOrNotFoundErrors = results.filter(
      (r) =>
        r.status === 'rejected' &&
        r.reason instanceof ValidationError &&
        r.reason.message === 'otp_expired_or_not_found',
    ).length

    // At most 5 requests passed hitBucket and reached OTP comparison
    expect(validationErrors).toBeLessThanOrEqual(5)
    // rateLimit + otp_expired_or_not_found together must be at least 15
    expect(rateLimitErrors + expiredOrNotFoundErrors).toBeGreaterThanOrEqual(15)
    // All 20 must be rejected
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    // No other error types (only otp_invalid, rate_limited, otp_expired_or_not_found)
    expect(validationErrors + rateLimitErrors + expiredOrNotFoundErrors).toBe(results.length)
  })

  it('re-requesting OTP does not reset the attempt counter (M2-T13 item 3)', async () => {
    setupSettingsMocks()
    const school = await seedSchool()
    const student = await createStudent(testDb)
    const ctx = { userId: student.userId }

    // Create initial OTP record
    const otp = '555555'
    await testDb.verification.create({
      data: {
        identifier: `school-otp:${student.userId}`,
        value: JSON.stringify({ hash: hashOtp(otp), schoolId: school.id, schoolEmail: 'student@test.edu.my' }),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    })

    // Wrong guess 3 times — each should be ValidationError('otp_invalid')
    for (let i = 0; i < 3; i++) {
      await expect(verifySchoolOtp(ctx, { otp: '000000' })).rejects.toThrow(ValidationError)
    }

    // Re-request OTP (should be allowed; bucket still at count=3, not cleared)
    await expect(
      requestSchoolOtp(ctx, { schoolId: school.id, schoolEmail: 'student@test.edu.my' })
    ).resolves.toBeUndefined()

    // Wrong guess 2 more times (attempt 4 and 5) — still ValidationError
    await expect(verifySchoolOtp(ctx, { otp: '000000' })).rejects.toThrow(ValidationError)
    await expect(verifySchoolOtp(ctx, { otp: '000000' })).rejects.toThrow(ValidationError)

    // 6th attempt (count=6, limit=5) must be RateLimitedError — bucket not reset by re-request
    await expect(verifySchoolOtp(ctx, { otp: '000000' })).rejects.toThrow(RateLimitedError)
  })

  it('lockout blocks both requestSchoolOtp and verifySchoolOtp until expiry', async () => {
    setupSettingsMocks()
    const school = await seedSchool()
    const student = await createStudent(testDb)
    const ctx = { userId: student.userId }

    // Create initial OTP record
    const otp = '111111'
    await testDb.verification.create({
      data: {
        identifier: `school-otp:${student.userId}`,
        value: JSON.stringify({ hash: hashOtp(otp), schoolId: school.id, schoolEmail: 'student@test.edu.my' }),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    })

    // Exhaust the bucket: 5 allowed attempts + 1 that triggers lockout
    for (let i = 0; i < 5; i++) {
      await expect(verifySchoolOtp(ctx, { otp: '000000' })).rejects.toThrow(ValidationError)
    }
    await expect(verifySchoolOtp(ctx, { otp: '000000' })).rejects.toThrow(RateLimitedError)

    // requestSchoolOtp also blocked during lockout (assertNotLocked runs there too)
    await expect(
      requestSchoolOtp(ctx, { schoolId: school.id, schoolEmail: 'student@test.edu.my' })
    ).rejects.toThrow(RateLimitedError)

    // Verify also still blocked with RateLimitedError (lock record still exists)
    await expect(verifySchoolOtp(ctx, { otp: otp })).rejects.toThrow(RateLimitedError)
  })
})
