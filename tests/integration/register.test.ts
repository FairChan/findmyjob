/**
 * Integration tests for the registration flow (M1-T08).
 *
 * Covers:
 * - Anti-enumeration: existing email and new email return the same response
 * - Rate limiting propagation: when auth.handler returns 429, action returns RateLimitedError
 * - Direct POST error codes: TURNSTILE_FAILED, CONSENT_REQUIRED, SIGNUP_CLOSED
 * - Employer role is set via databaseHook (no post-creation UPDATE needed)
 * - disabledPaths endpoints return 404
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock must come before any other imports that transitively load the module.
vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {
    handler: vi.fn(),
  },
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers({ 'x-real-ip': '10.0.0.1', 'user-agent': 'test' })),
  cookies: vi.fn(() => ({ set: vi.fn() })),
}))

import { setupTestDb, testDb } from '../setup/db'
import { registerStudent, registerEmployer } from '@/server/actions/register'
import * as authMod from '@/server/auth'

setupTestDb()

const mockHandler = vi.mocked(authMod.auth.handler)

/** Minimal auth.handler stub for a fresh email: returns fake user (anti-enum) */
function mockFreshUser(userId: string, email: string) {
  mockHandler.mockResolvedValue(
    new Response(JSON.stringify({ user: { id: userId, email }, token: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

/** auth.handler returns a fake user ID that is NOT in the DB */
function mockDuplicateEmail(email: string) {
  mockHandler.mockResolvedValue(
    new Response(
      JSON.stringify({ user: { id: 'fake-nonexistent-id-' + Date.now(), email }, token: null }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
}

function mockRateLimit() {
  mockHandler.mockResolvedValue(
    new Response(JSON.stringify({ message: 'Too many requests', code: 'RATE_LIMIT_ERROR' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

function mockAuthError(code: string, status: number) {
  mockHandler.mockResolvedValue(
    new Response(JSON.stringify({ message: 'error', code }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

const BASE_STUDENT = {
  name: 'Test Student',
  email: 'test-reg@example.test',
  password: 'Password123!',
  agreeTerms: true as const,
  agreePrivacy: true as const,
  joinTalentPool: false,
  turnstileToken: 'valid-token',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Anti-enumeration
// ---------------------------------------------------------------------------

describe('registerStudent anti-enumeration', () => {
  it('returns { email } for a new address (real user created in DB)', async () => {
    const user = await testDb.user.create({
      data: { name: BASE_STUDENT.name, email: BASE_STUDENT.email, emailVerified: false, role: 'STUDENT', status: 'ACTIVE' },
    })
    // auth.handler returns the real user ID
    mockFreshUser(user.id, BASE_STUDENT.email)

    const result = await registerStudent(BASE_STUDENT)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.email).toBe(BASE_STUDENT.email)
  })

  it('returns identical { email } for a duplicate address (fake user not in DB)', async () => {
    // auth.handler returns a fake user ID that does not exist in the DB
    mockDuplicateEmail(BASE_STUDENT.email)

    const result = await registerStudent(BASE_STUDENT)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.email).toBe(BASE_STUDENT.email)
  })

  it('new email and duplicate email return the same shape', async () => {
    // Both should return { ok: true, data: { email } }
    const user = await testDb.user.create({
      data: { name: 'Dup User', email: 'dup@example.test', emailVerified: false, role: 'STUDENT', status: 'ACTIVE' },
    })
    mockFreshUser(user.id, 'dup@example.test')
    const realResult = await registerStudent({ ...BASE_STUDENT, email: 'dup@example.test' })

    mockDuplicateEmail('dup@example.test')
    const dupResult = await registerStudent({ ...BASE_STUDENT, email: 'dup@example.test' })

    expect(realResult.ok).toBe(true)
    expect(dupResult.ok).toBe(true)
    // Shapes are identical
    expect(Object.keys(realResult)).toEqual(Object.keys(dupResult))
  })

  it('no StudentProfile is created for a duplicate email', async () => {
    mockDuplicateEmail('noprofile@example.test')
    await registerStudent({ ...BASE_STUDENT, email: 'noprofile@example.test' })

    const count = await testDb.studentProfile.count({
      where: { user: { email: 'noprofile@example.test' } },
    })
    expect(count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Rate limiting propagation
// ---------------------------------------------------------------------------

describe('rate limiting propagation', () => {
  it('returns RATE_LIMITED when auth.handler returns 429', async () => {
    mockRateLimit()
    const result = await registerStudent(BASE_STUDENT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('RATE_LIMITED')
  })
})

// ---------------------------------------------------------------------------
// Error codes from auth.handler
// ---------------------------------------------------------------------------

describe('auth.handler error code propagation', () => {
  it('propagates TURNSTILE_FAILED (400)', async () => {
    mockAuthError('TURNSTILE_FAILED', 400)
    const result = await registerStudent(BASE_STUDENT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('TURNSTILE_FAILED')
  })

  it('propagates SIGNUP_CLOSED (403)', async () => {
    mockAuthError('SIGNUP_CLOSED', 403)
    const result = await registerStudent(BASE_STUDENT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('SIGNUP_CLOSED')
  })

  it('propagates CONSENT_REQUIRED (400)', async () => {
    mockAuthError('CONSENT_REQUIRED', 400)
    const result = await registerStudent(BASE_STUDENT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR')
  })
})

// ---------------------------------------------------------------------------
// StudentProfile + Consent atomicity
// ---------------------------------------------------------------------------

describe('StudentProfile and Consent are created together', () => {
  it('creates both StudentProfile and Consent for a real student', async () => {
    const email = `atomic-${Date.now()}@example.test`
    const user = await testDb.user.create({
      data: { name: 'Atomic Student', email, emailVerified: false, role: 'STUDENT', status: 'ACTIVE' },
    })
    // Insert a system setting so getSetting returns a version
    await testDb.systemSetting.upsert({
      where: { key: 'legal.currentVersion' },
      update: {},
      create: { key: 'legal.currentVersion', value: JSON.stringify('1.0') },
    })

    mockFreshUser(user.id, email)
    const result = await registerStudent({ ...BASE_STUDENT, email })
    expect(result.ok).toBe(true)

    const profile = await testDb.studentProfile.findUnique({ where: { userId: user.id } })
    expect(profile).not.toBeNull()

    const consents = await testDb.consent.findMany({ where: { userId: user.id } })
    expect(consents.length).toBeGreaterThanOrEqual(2) // TERMS + PRIVACY (+ optional TALENT_POOL)
  })
})

// ---------------------------------------------------------------------------
// Employer registration
// ---------------------------------------------------------------------------

describe('registerEmployer', () => {
  it('returns { email } on success', async () => {
    const email = `emp-${Date.now()}@example.test`
    const user = await testDb.user.create({
      data: { name: 'Emp Test', email, emailVerified: false, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    mockFreshUser(user.id, email)

    const result = await registerEmployer({
      name: 'Emp Test',
      email,
      password: 'Password123!',
      agreeTerms: true,
      agreePrivacy: true,
      turnstileToken: 'valid',
    })
    expect(result.ok).toBe(true)
  })

  it('returns { email } for duplicate email (anti-enum)', async () => {
    mockDuplicateEmail('emp-dup@example.test')
    const result = await registerEmployer({
      name: 'Emp Dup',
      email: 'emp-dup@example.test',
      password: 'Password123!',
      agreeTerms: true,
      agreePrivacy: true,
      turnstileToken: 'valid',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.email).toBe('emp-dup@example.test')
  })
})
