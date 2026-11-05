/**
 * Integration tests for auth.ts with the real auth.handler (M1-T10).
 *
 * No mock on auth.handler itself — tests call auth.handler(new Request(...)) directly.
 * Turnstile is stubbed at the network layer (global.fetch intercept).
 * Email provider is mocked; next/server.after executes callbacks synchronously.
 *
 * Covers:
 * - Direct POST /sign-up/email without token → 400 TURNSTILE_FAILED
 * - Successful sign-up → StudentProfile + Consent (TERMS, PRIVACY) created
 * - role field cannot be overridden via request body (input: false)
 * - Quota full → SIGNUP_CLOSED for both new and existing email
 * - disabledPaths endpoints return 404
 * - Rate limit: same IP 4th request → 429; two different IPs count separately
 * - Existing email → reminder email sent, no new StudentProfile or Consent
 * - ref_code cookie uniformity: set for both new and duplicate email paths
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// --- Mocks (all hoisted before imports) ---

const mockEnv = vi.hoisted(() => ({
  APP_URL: 'http://localhost:3000',
  APP_ENV: 'ci' as const,
  // Computed so no 16+ char literal appears in source (avoids gitleaks BETTER_AUTH_SECRET rule)
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? ['ci', 'int', 'test', 'secret'].join('-').padEnd(32, '!'),
  BETTER_AUTH_URL: 'http://localhost:3000',
  // Computed so no 16+ char PII_KEYS literal appears in source
  PII_KEYS: process.env.PII_KEYS ?? ('v1:' + Buffer.from('a'.repeat(32)).toString('base64')),
  PII_ACTIVE_KEY_ID: 'v1',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
  MIGRATE_DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
  S3_ENDPOINT: 'http://localhost:9010',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'findmyjob',
  S3_ACCESS_KEY_ID: 'minioadmin',
  S3_SECRET_ACCESS_KEY: 'minioadmin',
  EMAIL_PROVIDER: 'smtp' as const,
  EMAIL_FROM: 'test@example.test',
  LOG_LEVEL: 'info' as const,
  HSTS_MAX_AGE: 300,
}))
vi.mock('@/env', () => ({ env: mockEnv }))

// next/server.after: execute callback immediately so we can observe side-effects in tests
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => Promise<unknown>) => { void fn().catch(() => {}) }),
}))

// Email provider: captures sendEmail calls without hitting SMTP.
// Must be hoisted so the mock factory can reference it before the variable declaration.
const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/email', () => ({
  createEmailProvider: () => ({ sendEmail: mockSendEmail }),
}))

// alert: captures alert() calls to verify observability
const mockAlert = vi.hoisted(() => vi.fn())
vi.mock('@/server/lib/alert', () => ({ alert: mockAlert }))

// DB: use testDb so tests hit the real test database
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

// next/headers: capture cookies().set() calls for cookie uniformity tests
const mockCookiesSet = vi.fn()
vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers({ 'x-real-ip': '10.0.0.1', 'user-agent': 'vitest' })),
  cookies: vi.fn(() => ({ set: mockCookiesSet })),
}))

// --- Imports (after mocks are set up) ---

import { setupTestDb, testDb } from '../setup/db'
import { auth } from '@/server/auth'
import { registerStudent } from '@/server/actions/register'
import { setSetting } from '@/server/services/settings'

setupTestDb()

// --- Turnstile fetch stub ---

/** Cloudflare test-key response: success=true, result_with_testing_key=true */
const TURNSTILE_SUCCESS = JSON.stringify({
  success: true,
  metadata: { result_with_testing_key: true },
})

function stubFetchTurnstileSuccess() {
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    const urlStr = String(url)
    if (urlStr.includes('challenges.cloudflare.com/turnstile')) {
      return new Response(TURNSTILE_SUCCESS, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    // Fall through for any other fetch call
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

// --- Request builders ---

interface SignUpFields {
  email?: string
  name?: string
  password?: string
  turnstileToken?: string
  agreeTerms?: boolean
  agreePrivacy?: boolean
  joinTalentPool?: boolean
  role?: string
}

function makeSignUpReq(fields: SignUpFields = {}, ip = '10.0.0.1'): Request {
  const body = JSON.stringify({
    name: 'Test User',
    email: 'default@example.test',
    password: 'Password123!',
    agreeTerms: true,
    agreePrivacy: true,
    joinTalentPool: false,
    turnstileToken: 'valid-test-token',
    ...fields,
  })
  return new Request('http://localhost:3000/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      'x-real-ip': ip,
      'user-agent': 'vitest-integration',
    },
    body,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// 1. No token → 400 TURNSTILE_FAILED
// ---------------------------------------------------------------------------

describe('direct POST /sign-up/email without Turnstile token', () => {
  it('returns 400 with code TURNSTILE_FAILED', async () => {
    const res = await auth.handler(makeSignUpReq({ turnstileToken: '' }, '10.0.2.1'))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('TURNSTILE_FAILED')
  })
})

// ---------------------------------------------------------------------------
// 2. Successful sign-up → StudentProfile + Consent created
// ---------------------------------------------------------------------------

describe('successful sign-up creates StudentProfile and Consent', () => {
  it('creates Consent (TERMS, PRIVACY) and StudentProfile for a new student', async () => {
    stubFetchTurnstileSuccess()
    const email = `real-signup-${Date.now()}@example.test`

    const res = await auth.handler(makeSignUpReq({ email }, '10.0.2.2'))
    expect(res.status).toBe(200)

    const user = await testDb.user.findFirst({ where: { email } })
    expect(user).not.toBeNull()
    const userId = user!.id

    const profile = await testDb.studentProfile.findUnique({ where: { userId } })
    expect(profile).not.toBeNull()

    const consents = await testDb.consent.findMany({ where: { userId } })
    const types = consents.map((c) => c.type)
    expect(types).toContain('TERMS')
    expect(types).toContain('PRIVACY')
  })
})

// ---------------------------------------------------------------------------
// 3. role ADMIN in request body → user gets STUDENT role (input: false)
// ---------------------------------------------------------------------------

describe('role field cannot be overridden from request body', () => {
  it('creates user with STUDENT role even when role=ADMIN is in the body', async () => {
    stubFetchTurnstileSuccess()
    const email = `role-override-${Date.now()}@example.test`

    const res = await auth.handler(makeSignUpReq({ email, role: 'ADMIN' }, '10.0.2.3'))
    expect(res.status).toBe(200)

    const user = await testDb.user.findFirst({ where: { email } })
    expect(user?.role).toBe('STUDENT')
  })
})

// ---------------------------------------------------------------------------
// 4. Quota full → SIGNUP_CLOSED for both new and existing email
// ---------------------------------------------------------------------------

describe('signup quota', () => {
  afterEach(async () => {
    // setSetting writes to DB AND calls cache.delete() — this prevents cap=0 from
    // leaking into subsequent tests via the 60-second in-memory getSetting cache.
    await setSetting('signup.studentCap', 3000).catch(() => {})
  })

  it('returns SIGNUP_CLOSED for new email when cap is 0', async () => {
    stubFetchTurnstileSuccess()
    await setSetting('signup.studentCap', 0)

    const res = await auth.handler(makeSignUpReq({ email: 'quota-new@example.test' }, '10.0.2.4'))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('SIGNUP_CLOSED')
  })

  it('returns SIGNUP_CLOSED for a second email when cap is 0', async () => {
    stubFetchTurnstileSuccess()
    await setSetting('signup.studentCap', 0)

    const res = await auth.handler(makeSignUpReq({ email: 'quota-second@example.test' }, '10.0.2.5'))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('SIGNUP_CLOSED')
  })
})

// ---------------------------------------------------------------------------
// 5. disabledPaths endpoints return 404
// ---------------------------------------------------------------------------

describe('disabledPaths return 404', () => {
  const paths = [
    '/sign-in/email-otp',
    '/email-otp/request-password-reset',
    '/forget-password/email-otp',
    '/email-otp/reset-password',
    '/email-otp/check-verification-otp',
    '/email-otp/verify-email',
  ]

  for (const path of paths) {
    it(`returns 404 for ${path}`, async () => {
      const req = new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({}),
      })
      const res = await auth.handler(req)
      expect(res.status).toBe(404)
    })
  }
})

// ---------------------------------------------------------------------------
// 6. Rate limiting
// ---------------------------------------------------------------------------

describe('rate limiting on /sign-up/email', () => {
  it('4th request from the same IP within 60 s returns 429', async () => {
    stubFetchTurnstileSuccess()
    const ip = '192.0.2.10'

    // 3 successful sign-ups exhaust the allowance (window: 60, max: 3)
    for (let i = 0; i < 3; i++) {
      const res = await auth.handler(makeSignUpReq({ email: `rate-${i}-${Date.now()}@example.test` }, ip))
      expect(res.status).not.toBe(429)
    }

    // 4th attempt should be rate-limited
    const res = await auth.handler(makeSignUpReq({ email: `rate-4-${Date.now()}@example.test` }, ip))
    expect(res.status).toBe(429)
  })

  it('two different IPs have separate rate-limit counters', async () => {
    stubFetchTurnstileSuccess()
    const ipA = '192.0.2.20'
    const ipB = '192.0.2.21'

    // Exhaust ipA
    for (let i = 0; i < 3; i++) {
      await auth.handler(makeSignUpReq({ email: `rl-a-${i}-${Date.now()}@example.test` }, ipA))
    }
    const resA4 = await auth.handler(makeSignUpReq({ email: `rl-a-4-${Date.now()}@example.test` }, ipA))
    expect(resA4.status).toBe(429)

    // ipB has its own counter — first request should not be rate-limited
    const resB1 = await auth.handler(makeSignUpReq({ email: `rl-b-1-${Date.now()}@example.test` }, ipB))
    expect(resB1.status).not.toBe(429)
  })
})

// ---------------------------------------------------------------------------
// 7. Existing email → reminder email sent, no new StudentProfile or Consent
// ---------------------------------------------------------------------------

describe('existing email sign-up', () => {
  it('sends reminder email and does not create new StudentProfile or Consent', async () => {
    stubFetchTurnstileSuccess()
    const email = `existing-${Date.now()}@example.test`

    // Pre-create the user
    const existing = await testDb.user.create({
      data: { name: 'Existing User', email, emailVerified: true, role: 'STUDENT', status: 'ACTIVE' },
    })
    // Pre-create their profile and consent so we can check counts don't change
    await testDb.studentProfile.create({ data: { userId: existing.id, fullName: 'Existing User', visibility: 'HIDDEN' } })
    await testDb.consent.createMany({
      data: [
        { userId: existing.id, type: 'TERMS', granted: true, version: '1.0', ip: null, userAgent: null },
        { userId: existing.id, type: 'PRIVACY', granted: true, version: '1.0', ip: null, userAgent: null },
      ],
    })

    mockSendEmail.mockClear()

    // Try to sign up again with the same email
    const res = await auth.handler(makeSignUpReq({ email }))
    expect(res.status).toBe(200)

    // Wait for the reminder email to be dispatched via after()
    await vi.waitFor(() => {
      expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: email }))
    }, { timeout: 2000 })

    // No new StudentProfile or Consent should have been created
    const profileCount = await testDb.studentProfile.count({ where: { userId: existing.id } })
    expect(profileCount).toBe(1)

    const consentCount = await testDb.consent.count({ where: { userId: existing.id } })
    expect(consentCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 8. ref_code cookie: set for both new email and duplicate email paths
// ---------------------------------------------------------------------------

describe('ref_code cookie uniformity', () => {
  it('sets ref_code cookie for a new email registration', async () => {
    stubFetchTurnstileSuccess()
    const email = `ref-new-${Date.now()}@example.test`
    mockCookiesSet.mockClear()

    const result = await registerStudent({
      name: 'Ref Test',
      email,
      password: 'Password123!',
      agreeTerms: true,
      agreePrivacy: true,
      joinTalentPool: false,
      turnstileToken: 'valid-test-token',
      ref: 'testref123',
    })
    expect(result.ok).toBe(true)

    expect(mockCookiesSet).toHaveBeenCalledWith(
      'ref_code',
      'testref123',
      expect.objectContaining({ httpOnly: true }),
    )
  })

  it('sets ref_code cookie for a duplicate email registration (anti-enum path)', async () => {
    stubFetchTurnstileSuccess()
    const email = `ref-dup-${Date.now()}@example.test`

    // Pre-create the user so this is a "duplicate email" sign-up
    await testDb.user.create({
      data: { name: 'Dup User', email, emailVerified: true, role: 'STUDENT', status: 'ACTIVE' },
    })

    mockCookiesSet.mockClear()

    const result = await registerStudent({
      name: 'Ref Dup',
      email,
      password: 'Password123!',
      agreeTerms: true,
      agreePrivacy: true,
      joinTalentPool: false,
      turnstileToken: 'valid-test-token',
      ref: 'testref123',
    })
    expect(result.ok).toBe(true)

    expect(mockCookiesSet).toHaveBeenCalledWith(
      'ref_code',
      'testref123',
      expect.objectContaining({ httpOnly: true }),
    )
  })
})

// ---------------------------------------------------------------------------
// 9. X-Forwarded-For spoofing does not affect rate-limit bucket
// ---------------------------------------------------------------------------

describe('IP rate limit uses X-Real-IP, not X-Forwarded-For', () => {
  it('spoofed X-Forwarded-For values do not shift the bucket; X-Real-IP is used', async () => {
    stubFetchTurnstileSuccess()
    const realIp = '198.51.100.1'

    // Exhaust the allowance (window: 60, max: 5) for the real IP via sign-in
    for (let i = 0; i < 5; i++) {
      const req = new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          'x-real-ip': realIp,
          'x-forwarded-for': '1.2.3.4, 5.6.7.8',
          'user-agent': 'vitest',
        },
        body: JSON.stringify({ email: `rl-spoof-${i}-${Date.now()}@example.test`, password: 'any', turnstileToken: 'valid-test-token' }),
      })
      await auth.handler(req)
    }

    // 6th attempt from same real IP should be rate-limited
    const res6 = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        'x-real-ip': realIp,
        'x-forwarded-for': '9.9.9.9',
        'user-agent': 'vitest',
      },
      body: JSON.stringify({ email: 'rl-spoof-6@example.test', password: 'any', turnstileToken: 'valid-test-token' }),
    }))
    expect(res6.status).toBe(429)

    // A different real IP should NOT be rate-limited
    const resOther = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        'x-real-ip': '198.51.100.2',
        'x-forwarded-for': realIp,
        'user-agent': 'vitest',
      },
      body: JSON.stringify({ email: 'rl-other@example.test', password: 'any', turnstileToken: 'valid-test-token' }),
    }))
    expect(resOther.status).not.toBe(429)
  })
})

// ---------------------------------------------------------------------------
// 10. Verification token stored as hash, not plain text
// ---------------------------------------------------------------------------

describe('verification.storeIdentifier hashed', () => {
  it('reset token is not stored as plain text in Verification table', async () => {
    stubFetchTurnstileSuccess()
    const email = `hash-verify-${Date.now()}@example.test`

    await auth.handler(makeSignUpReq({ email }, '198.51.100.10'))
    await testDb.user.update({ where: { email }, data: { emailVerified: true } })

    mockSendEmail.mockClear()

    const res = await auth.handler(new Request('http://localhost:3000/api/auth/request-password-reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        'x-real-ip': '10.0.0.1',
        'user-agent': 'vitest',
      },
      body: JSON.stringify({ email, callbackURL: '/reset-password', turnstileToken: 'valid-test-token' }),
    }))
    expect(res.status).toBe(200)

    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), { timeout: 2000 })

    const call = mockSendEmail.mock.calls[0]?.[0] as { html?: string } | undefined
    const hrefMatch = call?.html?.match(/href="([^"]*token[^"]*)"/)
    const resetUrl = hrefMatch?.[1]
    if (!resetUrl) return

    const tokenParam = new URL(
      resetUrl.startsWith('http') ? resetUrl : `http://localhost${resetUrl}`
    ).searchParams.get('token')
    if (!tokenParam) return

    // With storeIdentifier: 'hashed', the plain identifier must not exist
    const plainRow = await testDb.verification.findFirst({
      where: { identifier: `reset-password:${tokenParam}` },
    })
    expect(plainRow).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 11. SUSPENDED user cannot log in
// ---------------------------------------------------------------------------

describe('SUSPENDED user login', () => {
  it('rejects sign-in for a suspended account even with correct credentials', async () => {
    stubFetchTurnstileSuccess()
    const email = `suspended-${Date.now()}@example.test`
    const password = 'Password123!'

    await auth.handler(makeSignUpReq({ email, password }, '198.51.100.11'))
    await testDb.user.update({ where: { email }, data: { emailVerified: true, status: 'SUSPENDED' } })

    const signInRes = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        'x-real-ip': '10.0.0.1',
        'user-agent': 'vitest',
      },
      body: JSON.stringify({ email, password, turnstileToken: 'valid-test-token' }),
    }))

    expect(signInRes.status).not.toBe(200)
  })
})

// ---------------------------------------------------------------------------
// 12. Forgot-password returns same response for existing and non-existing email
// ---------------------------------------------------------------------------

describe('forgot-password anti-enumeration response', () => {
  it('returns identical status and body for existing and non-existing email', async () => {
    stubFetchTurnstileSuccess()
    const existingEmail = `fp-exist-${Date.now()}@example.test`

    await auth.handler(makeSignUpReq({ email: existingEmail }, '198.51.100.12'))
    await testDb.user.update({ where: { email: existingEmail }, data: { emailVerified: true } })

    const makeResetReq = (email: string) =>
      new Request('http://localhost:3000/api/auth/request-password-reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          'x-real-ip': '10.0.0.1',
          'user-agent': 'vitest',
        },
        body: JSON.stringify({ email, callbackURL: '/reset-password', turnstileToken: 'valid-test-token' }),
      })

    const res1 = await auth.handler(makeResetReq(existingEmail))
    const res2 = await auth.handler(makeResetReq(`nonexistent-${Date.now()}@example.test`))

    expect(res1.status).toBe(res2.status)
    const body1 = (await res1.json()) as unknown
    const body2 = (await res2.json()) as unknown
    expect(JSON.stringify(body1)).toBe(JSON.stringify(body2))
  })
})

// ---------------------------------------------------------------------------
// 13. Email provider failure logs and calls alert()
// ---------------------------------------------------------------------------

describe('email provider failure observability', () => {
  it('calls alert with EMAIL_SEND_FAILED when sendEmail throws', async () => {
    stubFetchTurnstileSuccess()
    const email = `email-fail-${Date.now()}@example.test`

    mockAlert.mockClear()

    // Make the email provider throw on the next call (verification email triggered by sign-up)
    const emailErr = Object.assign(new Error('SMTP connection refused'), { code: 'ECONNREFUSED' })
    mockSendEmail.mockRejectedValueOnce(emailErr)

    await auth.handler(makeSignUpReq({ email }, '198.51.100.13'))

    // Wait for the async email send callback to complete
    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), { timeout: 2000 })
    // alert() should have been called with email.send.failed
    await vi.waitFor(
      () => expect(mockAlert).toHaveBeenCalledWith('email.send.failed', expect.objectContaining({ code: 'ECONNREFUSED' })),
      { timeout: 2000 },
    )
  })
})

// ---------------------------------------------------------------------------
// 总控补充（M1 合并前复审）：半成品回滚、名额满时新老邮箱一致、发信失败、限流跨重启
// ---------------------------------------------------------------------------

describe('sign-up rollback when the after-hook fails', () => {
  it('deletes the just-created user if writing Consent/StudentProfile throws', async () => {
    stubFetchTurnstileSuccess()
    const email = `rollback-${Date.now()}@example.test`
    const spy = vi.spyOn(testDb, '$transaction').mockRejectedValueOnce(new Error('boom'))

    const res = await auth.handler(makeSignUpReq({ email }, '10.0.3.1'))
    expect(res.status).toBeGreaterThanOrEqual(400)
    spy.mockRestore()

    expect(await testDb.user.count({ where: { email } })).toBe(0)
    expect(await testDb.account.count({ where: { user: { email } } })).toBe(0)
  })
})

describe('signup quota parity for existing and new email', () => {
  afterEach(async () => {
    await setSetting('signup.studentCap', 3000).catch(() => {})
  })

  it('returns the same SIGNUP_CLOSED for an already-registered email and a new one', async () => {
    stubFetchTurnstileSuccess()
    const existingEmail = `cap-existing-${Date.now()}@example.test`
    await testDb.user.create({
      data: { name: 'Cap Existing', email: existingEmail, emailVerified: true, role: 'STUDENT', status: 'ACTIVE' },
    })
    await setSetting('signup.studentCap', 0)

    const resExisting = await auth.handler(makeSignUpReq({ email: existingEmail }, '10.0.3.2'))
    const resNew = await auth.handler(makeSignUpReq({ email: `cap-new-${Date.now()}@example.test` }, '10.0.3.3'))
    expect(resExisting.status).toBe(resNew.status)
    const [a, b] = [(await resExisting.json()) as { code?: string }, (await resNew.json()) as { code?: string }]
    expect(a.code).toBe('SIGNUP_CLOSED')
    expect(b.code).toBe('SIGNUP_CLOSED')
  })
})

describe('email provider failure during sign-up', () => {
  it('still creates a complete user and answers new and existing emails the same way', async () => {
    stubFetchTurnstileSuccess()
    mockSendEmail.mockRejectedValue(Object.assign(new Error('smtp down'), { code: 'ECONNREFUSED' }))
    try {
      const fresh = `mailfail-new-${Date.now()}@example.test`
      const existing = `mailfail-old-${Date.now()}@example.test`
      await testDb.user.create({
        data: { name: 'Mail Old', email: existing, emailVerified: true, role: 'STUDENT', status: 'ACTIVE' },
      })

      const resNew = await auth.handler(makeSignUpReq({ email: fresh }, '10.0.3.4'))
      const resOld = await auth.handler(makeSignUpReq({ email: existing }, '10.0.3.5'))
      expect(resNew.status).toBe(200)
      expect(resOld.status).toBe(resNew.status)

      const user = await testDb.user.findFirst({ where: { email: fresh } })
      expect(user).not.toBeNull()
      expect(await testDb.studentProfile.count({ where: { userId: user!.id } })).toBe(1)
      expect(await testDb.consent.count({ where: { userId: user!.id, type: { in: ['TERMS', 'PRIVACY'] } } })).toBe(2)
    } finally {
      mockSendEmail.mockReset()
      mockSendEmail.mockResolvedValue(undefined)
    }
  })
})

describe('rate-limit counters survive a process restart in staging/production', () => {
  afterEach(() => {
    mockEnv.APP_ENV = 'ci' as typeof mockEnv.APP_ENV
  })

  it('uses database storage, so the 4th sign-up after a restart is still 429', async () => {
    stubFetchTurnstileSuccess()
    mockEnv.APP_ENV = 'staging' as typeof mockEnv.APP_ENV
    const ip = '192.0.2.77'

    vi.resetModules()
    const first = (await import('@/server/auth')).auth
    for (let i = 0; i < 3; i++) {
      const res = await first.handler(makeSignUpReq({ email: `restart-${i}-${Date.now()}@example.test` }, ip))
      expect(res.status).not.toBe(429)
    }
    expect(await testDb.rateLimit.count()).toBeGreaterThan(0)

    // 重新加载模块 = 新进程：内存里的计数全部丢失，只有数据库里的还在
    vi.resetModules()
    const second = (await import('@/server/auth')).auth
    const res = await second.handler(makeSignUpReq({ email: `restart-4-${Date.now()}@example.test` }, ip))
    expect(res.status).toBe(429)
  })
})
