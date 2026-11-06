import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

// ---- Mock env ----
vi.mock('@/env', () => ({ env: {} }))

// ---- Mock db ----
const mockDb = vi.hoisted(() => ({
  school: { findUnique: vi.fn() },
  studentProfile: {
    findFirst: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  verification: {
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
}))
vi.mock('@/server/db', () => ({ db: mockDb }))

// ---- Mock rate-limit (send limits) ----
const mockCheckRateLimit = vi.hoisted(() => vi.fn())
const mockClearRateLimit = vi.hoisted(() => vi.fn())
vi.mock('@/server/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  clearRateLimit: mockClearRateLimit,
}))

// ---- Mock db-rate-limit (verify attempts, atomic) ----
const mockHitBucket = vi.hoisted(() => vi.fn())
vi.mock('@/server/lib/db-rate-limit', () => ({ hitBucket: mockHitBucket }))

// ---- Mock settings ----
const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

// ---- Mock email ----
const mockSendEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email', () => ({
  createEmailProvider: () => ({ sendEmail: mockSendEmail }),
}))

import {
  requestSchoolOtp,
  verifySchoolOtp,
} from '@/server/services/school-verification'
import { ValidationError, RateLimitedError, NotFoundError } from '@/server/errors'

const USER_ID = 'cltest000000user00000'
const SCHOOL_ID = 'cltest000000school000'
const ctx = { userId: USER_ID }

const activeSchool = {
  id: SCHOOL_ID,
  emailDomains: ['xmu.edu.my'],
}

function otpIdentifier(userId: string) {
  return `school-otp:${userId}`
}
function lockIdentifier(userId: string) {
  return `school-otp-lock:${userId}`
}
function hashOtp(otp: string) {
  return crypto.createHash('sha256').update(otp).digest('hex')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSetting.mockResolvedValue(5)
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetAt: 0, count: 1 })
  mockHitBucket.mockResolvedValue({ allowed: true, remaining: 4, resetAt: 0, count: 1 })
  mockClearRateLimit.mockResolvedValue(undefined)
  mockDb.school.findUnique.mockResolvedValue(activeSchool)
  mockDb.studentProfile.findFirst.mockResolvedValue(null)
  mockDb.verification.findFirst.mockResolvedValue(null)
  mockDb.verification.deleteMany.mockResolvedValue({ count: 0 })
  mockDb.verification.create.mockResolvedValue({})
  mockDb.verification.update.mockResolvedValue({})
  mockDb.studentProfile.update.mockResolvedValue({})
  mockSendEmail.mockResolvedValue(undefined)
})

// ---- requestSchoolOtp ----

describe('requestSchoolOtp', () => {
  it('succeeds for a valid school email domain', async () => {
    await expect(
      requestSchoolOtp(ctx, { schoolId: SCHOOL_ID, schoolEmail: 'student@xmu.edu.my' }),
    ).resolves.toBeUndefined()
    expect(mockSendEmail).toHaveBeenCalledOnce()
    expect(mockDb.verification.create).toHaveBeenCalledOnce()
  })

  it('normalises email to lowercase before domain check', async () => {
    await expect(
      requestSchoolOtp(ctx, { schoolId: SCHOOL_ID, schoolEmail: 'Student@XMU.EDU.MY' }),
    ).resolves.toBeUndefined()
    // The stored email should be lowercase
    const createCall = mockDb.verification.create.mock.calls[0][0]
    const stored = JSON.parse(createCall.data.value)
    expect(stored.schoolEmail).toBe('student@xmu.edu.my')
  })

  it('rejects email whose domain does not match school.emailDomains', async () => {
    await expect(
      requestSchoolOtp(ctx, { schoolId: SCHOOL_ID, schoolEmail: 'student@evil.com' }),
    ).rejects.toThrow(ValidationError)
  })

  it('rejects subdomain spoofing — x@xmu.edu.my.evil.com', async () => {
    await expect(
      requestSchoolOtp(ctx, { schoolId: SCHOOL_ID, schoolEmail: 'x@xmu.edu.my.evil.com' }),
    ).rejects.toThrow(ValidationError)
  })

  it('rejects if the email is already verified by a different account', async () => {
    mockDb.studentProfile.findFirst.mockResolvedValue({ id: 'other-student' })
    await expect(
      requestSchoolOtp(ctx, { schoolId: SCHOOL_ID, schoolEmail: 'student@xmu.edu.my' }),
    ).rejects.toThrow(ValidationError)
  })

  it('throws RateLimitedError when user per-hour limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0, count: 6 })
    await expect(
      requestSchoolOtp(ctx, { schoolId: SCHOOL_ID, schoolEmail: 'student@xmu.edu.my' }),
    ).rejects.toThrow(RateLimitedError)
  })

  it('throws RateLimitedError when target email per-day limit is exceeded', async () => {
    // first call (user limit) passes, second call (email limit) fails
    mockCheckRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 4, resetAt: 0, count: 1 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0, count: 6 })
    await expect(
      requestSchoolOtp(ctx, { schoolId: SCHOOL_ID, schoolEmail: 'student@xmu.edu.my' }),
    ).rejects.toThrow(RateLimitedError)
  })

  it('throws NotFoundError for an unknown or inactive school', async () => {
    mockDb.school.findUnique.mockResolvedValue(null)
    await expect(
      requestSchoolOtp(ctx, { schoolId: SCHOOL_ID, schoolEmail: 'student@xmu.edu.my' }),
    ).rejects.toThrow(NotFoundError)
  })

  it('blocks the request when the user is locked out', async () => {
    // lockout row present and not expired — returned on the findFirst call in assertNotLocked
    mockDb.verification.findFirst.mockResolvedValueOnce({
      id: 'lock1',
      identifier: lockIdentifier(USER_ID),
      value: 'locked',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await expect(
      requestSchoolOtp(ctx, { schoolId: SCHOOL_ID, schoolEmail: 'student@xmu.edu.my' }),
    ).rejects.toThrow(RateLimitedError)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

// ---- verifySchoolOtp ----

function makeOtpRow(otp: string, expiresOffset = 10 * 60 * 1000) {
  return {
    id: 'ver1',
    identifier: otpIdentifier(USER_ID),
    value: JSON.stringify({
      hash: hashOtp(otp),
      schoolId: SCHOOL_ID,
      schoolEmail: 'student@xmu.edu.my',
    }),
    expiresAt: new Date(Date.now() + expiresOffset),
  }
}

describe('verifySchoolOtp', () => {
  const CORRECT_OTP = '123456'

  it('succeeds with correct OTP and writes schoolVerifiedAt', async () => {
    // first call = lockout check (null = not locked), second call = OTP lookup
    mockDb.verification.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeOtpRow(CORRECT_OTP))
    await expect(verifySchoolOtp(ctx, { otp: CORRECT_OTP })).resolves.toBeUndefined()
    expect(mockDb.studentProfile.update).toHaveBeenCalledOnce()
    const call = mockDb.studentProfile.update.mock.calls[0][0]
    expect(call.data.schoolVerifiedAt).toBeInstanceOf(Date)
    expect(call.data.schoolEmail).toBe('student@xmu.edu.my')
    expect(mockClearRateLimit).toHaveBeenCalledOnce()
  })

  it('throws ValidationError for wrong OTP', async () => {
    mockDb.verification.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeOtpRow(CORRECT_OTP))
    await expect(verifySchoolOtp(ctx, { otp: '000000' })).rejects.toThrow(ValidationError)
    // No longer increments attempts in JSON — hitBucket handles it
    expect(mockDb.verification.update).not.toHaveBeenCalled()
  })

  it('throws ValidationError when OTP record does not exist or is expired', async () => {
    // lockout check: null; OTP check: null
    mockDb.verification.findFirst.mockResolvedValue(null)
    await expect(verifySchoolOtp(ctx, { otp: CORRECT_OTP })).rejects.toThrow(ValidationError)
  })

  it('locks the user and throws RateLimitedError when bucket is exhausted (6th attempt)', async () => {
    mockDb.verification.findFirst
      .mockResolvedValueOnce(null)   // lockout check: not locked
      .mockResolvedValueOnce(makeOtpRow(CORRECT_OTP))  // OTP lookup
    // hitBucket returns not-allowed (6th attempt)
    mockHitBucket.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0, count: 6 })

    await expect(verifySchoolOtp(ctx, { otp: '000000' })).rejects.toThrow(RateLimitedError)
    // Should delete OTP and create a lock record
    expect(mockDb.verification.deleteMany).toHaveBeenCalled()
    expect(mockDb.verification.create).toHaveBeenCalledOnce()
    const createCall = mockDb.verification.create.mock.calls[0][0]
    expect(createCall.data.identifier).toBe(lockIdentifier(USER_ID))
    expect(createCall.data.expiresAt).toBeInstanceOf(Date)
    // Lock expiry should be ~30 minutes from now
    const lockExpiry = createCall.data.expiresAt.getTime()
    expect(lockExpiry).toBeGreaterThan(Date.now() + 29 * 60 * 1000)
    expect(lockExpiry).toBeLessThan(Date.now() + 31 * 60 * 1000)
  })

  it('throws RateLimitedError when user is locked out (existing lock record)', async () => {
    // first findFirst call (lockout check) returns a lock row
    mockDb.verification.findFirst.mockResolvedValueOnce({
      id: 'lock1',
      identifier: lockIdentifier(USER_ID),
      value: 'locked',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })
    await expect(verifySchoolOtp(ctx, { otp: CORRECT_OTP })).rejects.toThrow(RateLimitedError)
    expect(mockDb.studentProfile.update).not.toHaveBeenCalled()
  })

  it('throws ValidationError when unique constraint is violated (another account verified same email)', async () => {
    mockDb.verification.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeOtpRow(CORRECT_OTP))
    const prismaErr = Object.assign(new Error('Unique constraint'), { code: 'P2002' })
    mockDb.studentProfile.update.mockRejectedValue(prismaErr)
    await expect(verifySchoolOtp(ctx, { otp: CORRECT_OTP })).rejects.toThrow(ValidationError)
  })

  it('requestSchoolOtp expiresAt is ~10 minutes from now', async () => {
    const before = Date.now()
    await requestSchoolOtp(ctx, { schoolId: SCHOOL_ID, schoolEmail: 'student@xmu.edu.my' })
    const createCall = mockDb.verification.create.mock.calls[0][0]
    const expiresAt: Date = createCall.data.expiresAt
    expect(expiresAt).toBeInstanceOf(Date)
    expect(expiresAt.getTime()).toBeGreaterThan(before + 9 * 60 * 1000)
    expect(expiresAt.getTime()).toBeLessThan(before + 11 * 60 * 1000)
  })
})
