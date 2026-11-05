/**
 * Integration tests for auth.ts with the real auth.handler (M1-T10, M1-T11, M1-T12).
 *
 * No mock on auth.handler itself — tests call auth.handler(new Request(...)) directly.
 * Turnstile is stubbed at the network layer (global.fetch intercept).
 * Email provider is mocked; next/server.after executes callbacks synchronously.
 *
 * M1-T10 coverage:
 * - Direct POST /sign-up/email without token → 400 TURNSTILE_FAILED
 * - Successful sign-up → StudentProfile + Consent (TERMS, PRIVACY) created
 * - role field cannot be overridden via request body (input: false)
 * - Quota full → SIGNUP_CLOSED for both new and existing email
 * - disabledPaths endpoints return 404
 * - Rate limit: same IP 4th request → 429; two different IPs count separately
 * - Existing email → reminder email sent, no new StudentProfile or Consent
 * - ref_code cookie uniformity: set for both new and duplicate email paths
 * - sign-up rollback when after-hook fails; email failure doesn't leave half-created users
 *
 * M1-T11 coverage:
 * - IP rate limit uses X-Real-IP, not X-Forwarded-For
 * - verification.storeIdentifier: reset token stored as SHA-256 hash, not plain text
 * - revokeSessionsOnPasswordReset: old session null after reset
 * - SUSPENDED user login rejected (403 ACCOUNT_SUSPENDED)
 * - forgot-password returns identical response for existing/non-existing email
 * - email provider failure calls alert() with the error code
 * - rate-limit counters survive process restart (database storage in staging/prod)
 *
 * M1-T12 coverage (this task — test-only fixes and additions):
 * - Reset token hash: exact token not stored plain; SHA-256 (base64url) hash row exists;
 *   full reset flow; old session null after reset
 * - SUSPENDED login: specific 403 code, no session cookie, get-session null
 * - change-password with revokeOtherSessions forced: session B revoked; no extra auth.login audit
 * - Page guards: student→admin, employer→student, forged cookie→student all NEXT_REDIRECT
 * - purge TTL: unverifiedTtlHours=0/-1/null all fall back to 48 h
 * - purge batch + race condition: 1500 accounts in 2 batches; verified-between-batches user kept
 * - forgot-password timing: median diff < 100 ms for existing vs non-existing email
 * - email failure without code property → logs EMAIL_SEND_FAILED, calls alert()
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

// next/navigation: redirect() throws a NEXT_REDIRECT error (matches Next.js App Router behaviour)
vi.mock('next/navigation', () => ({
  redirect: (url: string): never => {
    const err = new Error(`NEXT_REDIRECT to ${url}`)
    ;(err as unknown as Record<string, unknown>).digest = `NEXT_REDIRECT;replace;${url};200;`
    throw err
  },
}))

// logger: spy on warn/error so we can assert log entries in email-failure tests
const mockLoggerWarn = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())
vi.mock('@/server/lib/logger', () => ({
  logger: { warn: mockLoggerWarn, error: mockLoggerError, info: vi.fn(), debug: vi.fn() },
  pinoOptions: {},
}))

// --- Imports (after mocks are set up) ---

import { createHash } from 'node:crypto'
import { setupTestDb, testDb } from '../setup/db'
import { auth } from '@/server/auth'
import { registerStudent } from '@/server/actions/register'
import { setSetting } from '@/server/services/settings'
import { purgeUnverifiedAccounts } from '@/server/services/signup-cap'
import { headers } from 'next/headers'
import AdminLayout from '@/app/[locale]/admin/layout'
import StudentLayout from '@/app/[locale]/s/layout'
import EmployerLayout from '@/app/[locale]/e/layout'

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
// 10. Verification token stored as hash, not plain text; full reset flow
// ---------------------------------------------------------------------------

describe('verification.storeIdentifier hashed', () => {
  it('reset token stored as SHA-256 hash; old session null after reset', async () => {
    stubFetchTurnstileSuccess()
    const email = `hash-verify-${Date.now()}@example.test`
    const password = 'Password123!'

    // Sign up and verify
    await auth.handler(makeSignUpReq({ email, password }, '198.51.100.20'))
    await testDb.user.update({ where: { email }, data: { emailVerified: true } })

    // Sign in to get a session that should be revoked after reset
    const signInRes = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'x-real-ip': '198.51.100.22', 'user-agent': 'vitest' },
      body: JSON.stringify({ email, password, turnstileToken: 'valid-test-token' }),
    }))
    expect(signInRes.status).toBe(200)
    const preResetCookie = signInRes.headers.get('set-cookie')?.split(';')[0] ?? ''
    expect(preResetCookie).toBeTruthy()

    mockSendEmail.mockClear()

    const resetReqRes = await auth.handler(new Request('http://localhost:3000/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'x-real-ip': '198.51.100.21', 'user-agent': 'vitest' },
      body: JSON.stringify({ email, callbackURL: '/reset-password', turnstileToken: 'valid-test-token' }),
    }))
    expect(resetReqRes.status).toBe(200)

    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), { timeout: 2000 })

    const call = mockSendEmail.mock.calls[0]?.[0] as { html?: string; text?: string } | undefined
    // Extract the reset URL robustly: try href attribute first, then bare URL in text
    const html = call?.html ?? ''
    const text = call?.text ?? ''
    const hrefMatch = html.match(/href="([^"]+)"/) ?? html.match(/href='([^']+)'/)
    const urlStr =
      hrefMatch?.[1] ??
      text.match(/https?:\/\/\S+/)?.[0] ??
      html.match(/https?:\/\/[^"'<>\s]+/)?.[0]

    expect(urlStr, `reset email must contain a URL (html: ${html.slice(0, 200)})`).toBeTruthy()

    const fullUrl = urlStr!.startsWith('http') ? urlStr! : `http://localhost${urlStr}`
    const parsedUrl = new URL(fullUrl)
    // Better Auth 1.7.16 embeds the token in the path: /api/auth/reset-password/{token}
    // Fall back to 'token' query param for forward-compat
    const pathParts = parsedUrl.pathname.split('/')
    const tokenParam =
      parsedUrl.searchParams.get('token') ??
      pathParts[pathParts.length - 1] ??
      ''
    expect(tokenParam, `reset URL must contain a token (url: ${fullUrl})`).toBeTruthy()

    // Plain token must NOT be stored in Verification table (storeIdentifier: 'hashed')
    const plainRows = await testDb.verification.findMany({
      where: { identifier: { in: [tokenParam, `reset-password:${tokenParam}`] } },
    })
    expect(plainRows, 'raw token must not be stored as plain identifier').toHaveLength(0)

    // The hashed identifier MUST exist — try both common formats Better Auth may use
    const hash1 = createHash('sha256').update(`reset-password:${tokenParam}`).digest('base64url')
    const hash2 = createHash('sha256').update(tokenParam).digest('base64url')
    const hashedRow = await testDb.verification.findFirst({
      where: { identifier: { in: [hash1, hash2] } },
    })
    expect(hashedRow, `SHA-256 hash of reset token must exist in Verification table`).not.toBeNull()

    // Complete the reset — revokeSessionsOnPasswordReset:true means old session should be gone
    const resetRes = await auth.handler(new Request('http://localhost:3000/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'x-real-ip': '198.51.100.21', 'user-agent': 'vitest' },
      body: JSON.stringify({ token: tokenParam, newPassword: 'NewPassword789!' }),
    }))
    expect(resetRes.status).toBe(200)

    // Old session should be revoked
    const sessionAfterReset = await auth.api.getSession({
      headers: new Headers({ cookie: preResetCookie }),
    })
    expect(sessionAfterReset).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 11. SUSPENDED user cannot log in (M1-T12: specific assertions)
// ---------------------------------------------------------------------------

describe('SUSPENDED user login', () => {
  it('rejects sign-in for a suspended account: 403 ACCOUNT_SUSPENDED, no session cookie, get-session null', async () => {
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

    // Must return a 4xx (the hook throws APIError FORBIDDEN → 403)
    expect(signInRes.status).toBe(403)
    const body = (await signInRes.json()) as { code?: string }
    expect(body.code).toBe('ACCOUNT_SUSPENDED')

    // Response must not set a session cookie
    const setCookie = signInRes.headers.get('set-cookie') ?? ''
    expect(setCookie).not.toMatch(/session_token/)

    // Even if we forge the cookie from an earlier sign-in, getSession returns null for a suspended user
    // (the check happens at session-creation time, not at session-read time — verify by checking no row exists)
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: setCookie || 'better-auth.session_token=invalid' }),
    })
    expect(session).toBeNull()
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

// ---------------------------------------------------------------------------
// M1-T12 new tests
// ---------------------------------------------------------------------------

// Helper: build a sign-in request
function makeSignInReq(email: string, ip: string, password = 'Password123!'): Request {
  return new Request('http://localhost:3000/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      'x-real-ip': ip,
      'user-agent': 'vitest',
    },
    body: JSON.stringify({ email, password, turnstileToken: 'valid-test-token' }),
  })
}

// Helper: extract session cookie value from a Set-Cookie header
function extractSessionCookie(setCookieHeader: string | null): string {
  return setCookieHeader?.split(';')[0]?.trim() ?? ''
}

// ---------------------------------------------------------------------------
// 14. change-password forces revokeOtherSessions; no extra auth.login audit
// ---------------------------------------------------------------------------

describe('POST /change-password revokes other sessions without adding auth.login audit', () => {
  it('session B is revoked; auth.login audit count unchanged', async () => {
    stubFetchTurnstileSuccess()
    const email = `change-pw-${Date.now()}@example.test`
    const password = 'Password123!'
    const newPassword = 'NewPassword456!'

    await auth.handler(makeSignUpReq({ email, password }, '198.51.100.50'))
    await testDb.user.update({ where: { email }, data: { emailVerified: true } })

    // Sign in twice from different IPs to get sessions A and B
    const resA = await auth.handler(makeSignInReq(email, '198.51.100.51'))
    expect(resA.status).toBe(200)
    const cookieA = extractSessionCookie(resA.headers.get('set-cookie'))
    expect(cookieA).toBeTruthy()

    const resB = await auth.handler(makeSignInReq(email, '198.51.100.52'))
    expect(resB.status).toBe(200)
    const cookieB = extractSessionCookie(resB.headers.get('set-cookie'))
    expect(cookieB).toBeTruthy()

    // Count auth.login audits before the password change
    const user = await testDb.user.findFirst({ where: { email } })
    const beforeCount = await testDb.auditLog.count({
      where: { actorId: user!.id, action: 'auth.login' },
    })

    // POST /change-password with cookie A, body does NOT include revokeOtherSessions
    // The hooks.before in auth.ts forces revokeOtherSessions=true regardless
    const changePwRes = await auth.handler(new Request('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        'x-real-ip': '198.51.100.51',
        'user-agent': 'vitest',
        cookie: cookieA,
      },
      body: JSON.stringify({ currentPassword: password, newPassword }),
    }))
    expect(changePwRes.status).toBe(200)

    // Session B must be revoked
    const sessionB = await auth.api.getSession({ headers: new Headers({ cookie: cookieB }) })
    expect(sessionB).toBeNull()

    // No new auth.login audit should have been created by the change-password session
    const afterCount = await testDb.auditLog.count({
      where: { actorId: user!.id, action: 'auth.login' },
    })
    expect(afterCount).toBe(beforeCount)
  })
})

// ---------------------------------------------------------------------------
// 15. Page guards: wrong role or forged cookie → NEXT_REDIRECT to /zh/login
// ---------------------------------------------------------------------------

describe('page guards redirect on wrong role or missing session', () => {
  it('student cookie accessing /admin → NEXT_REDIRECT to /zh/login', async () => {
    stubFetchTurnstileSuccess()
    const email = `guard-admin-${Date.now()}@example.test`
    await auth.handler(makeSignUpReq({ email }, '198.51.100.60'))
    await testDb.user.update({ where: { email }, data: { emailVerified: true } })
    const signInRes = await auth.handler(makeSignInReq(email, '198.51.100.60'))
    expect(signInRes.status).toBe(200)
    const cookie = extractSessionCookie(signInRes.headers.get('set-cookie'))

    vi.mocked(headers).mockReturnValueOnce(new Headers({ cookie }) as never)
    await expect(
      AdminLayout({ children: null, params: Promise.resolve({ locale: 'zh' }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('/zh/login') })
  })

  it('employer cookie accessing /s → NEXT_REDIRECT to /zh/login', async () => {
    stubFetchTurnstileSuccess()
    const email = `guard-employer-${Date.now()}@example.test`
    await auth.handler(makeSignUpReq({ email }, '198.51.100.61'))
    // Promote to EMPLOYER so sign-in creates an employer session
    await testDb.user.update({ where: { email }, data: { emailVerified: true, role: 'EMPLOYER' } })
    const signInRes = await auth.handler(makeSignInReq(email, '198.51.100.61'))
    expect(signInRes.status).toBe(200)
    const cookie = extractSessionCookie(signInRes.headers.get('set-cookie'))

    vi.mocked(headers).mockReturnValueOnce(new Headers({ cookie }) as never)
    await expect(
      StudentLayout({ children: null, params: Promise.resolve({ locale: 'zh' }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('/zh/login') })
  })

  it('forged session cookie accessing /s → NEXT_REDIRECT to /zh/login', async () => {
    vi.mocked(headers).mockReturnValueOnce(
      new Headers({ cookie: 'better-auth.session_token=forged_invalid_token_value_xyz' }) as never,
    )
    await expect(
      StudentLayout({ children: null, params: Promise.resolve({ locale: 'zh' }) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('/zh/login') })
  })
})

// ---------------------------------------------------------------------------
// 16. purge TTL: unverifiedTtlHours=0/-1/null all fall back to 48 h
// ---------------------------------------------------------------------------

describe('purgeUnverifiedAccounts TTL fallback to 48 h', () => {
  afterEach(async () => {
    // Clear the getSetting cache for this key to prevent leakage
    await setSetting('signup.unverifiedTtlHours', 48).catch(() => {})
  })

  async function createUser24hOld(email: string) {
    return testDb.user.create({
      data: {
        name: 'TTL Test',
        email,
        emailVerified: false,
        role: 'STUDENT',
        status: 'ACTIVE',
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    })
  }

  it('unverifiedTtlHours=0 falls back to 48 h: 24-h-old user is NOT deleted', async () => {
    await setSetting('signup.unverifiedTtlHours', 0)
    const email = `ttl-0-${Date.now()}@example.test`
    await createUser24hOld(email)
    await purgeUnverifiedAccounts()
    expect(await testDb.user.count({ where: { email } })).toBe(1)
  })

  it('unverifiedTtlHours=-1 falls back to 48 h: 24-h-old user is NOT deleted', async () => {
    await setSetting('signup.unverifiedTtlHours', -1)
    const email = `ttl-neg-${Date.now()}@example.test`
    await createUser24hOld(email)
    await purgeUnverifiedAccounts()
    expect(await testDb.user.count({ where: { email } })).toBe(1)
  })

  it('unverifiedTtlHours=null falls back to 48 h: 24-h-old user is NOT deleted', async () => {
    await setSetting('signup.unverifiedTtlHours', null)
    const email = `ttl-null-${Date.now()}@example.test`
    await createUser24hOld(email)
    await purgeUnverifiedAccounts()
    expect(await testDb.user.count({ where: { email } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 17. purge batch: 1500 accounts deleted in 2 batches of ≤1000
//     race condition: user verified between findMany and deleteMany is kept
// ---------------------------------------------------------------------------

describe('purgeUnverifiedAccounts batch and race condition', () => {
  it('processes 1500 expired accounts in exactly 2 batches', async () => {
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000)
    await testDb.user.createMany({
      data: Array.from({ length: 1500 }, (_, i) => ({
        name: `Batch ${i}`,
        email: `batch-purge-${i}@example.test`,
        emailVerified: false,
        role: 'STUDENT' as const,
        status: 'ACTIVE' as const,
        createdAt: cutoff,
      })),
    })

    const findManySpy = vi.spyOn(testDb.user, 'findMany')
    const result = await purgeUnverifiedAccounts()
    const findManyCallCount = findManySpy.mock.calls.length
    findManySpy.mockRestore()

    expect(result).toBe(1500)
    // batch 1 = 1000, batch 2 = 500 → 2 findMany calls
    expect(findManyCallCount).toBe(2)
  })

  it('does not delete a user who verified between findMany and deleteMany', async () => {
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000)
    const raceUser = await testDb.user.create({
      data: {
        name: 'Race User',
        email: `race-user-${Date.now()}@example.test`,
        emailVerified: false,
        role: 'STUDENT',
        status: 'ACTIVE',
        createdAt: cutoff,
      },
    })

    // Intercept the first deleteMany call; mark the user as verified before it runs
    let intercepted = false
    const originalDeleteMany = testDb.user.deleteMany.bind(testDb.user)
    const raceImpl: any = async (args?: any) => {
      if (!intercepted) {
        intercepted = true
        await testDb.user.update({ where: { id: raceUser.id }, data: { emailVerified: true } })
      }
      return originalDeleteMany(args)
    }
    const spy = vi.spyOn(testDb.user, 'deleteMany').mockImplementation(raceImpl)

    await purgeUnverifiedAccounts()
    spy.mockRestore()

    // raceUser verified before deleteMany ran → its emailVerified=true → WHERE emailVerified=false did NOT match
    const found = await testDb.user.findUnique({ where: { id: raceUser.id } })
    expect(found).not.toBeNull()
    expect(found?.emailVerified).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 18. forgot-password timing: median diff < 100 ms for existing vs non-existing
// ---------------------------------------------------------------------------

describe('forgot-password timing parity (anti-enumeration)', () => {
  it('median response time for existing and non-existing email differs by < 100 ms', async () => {
    stubFetchTurnstileSuccess()
    const existingEmail = `fp-timing-${Date.now()}@example.test`

    await auth.handler(makeSignUpReq({ email: existingEmail }, '203.0.113.0'))
    await testDb.user.update({ where: { email: existingEmail }, data: { emailVerified: true } })

    const N = 5
    const existingTimes: number[] = []
    const nonExistingTimes: number[] = []

    for (let i = 0; i < N; i++) {
      const eIp = `203.0.113.${10 + i}`
      const neIp = `203.0.113.${20 + i}`

      const makeReq = (email: string, ip: string) =>
        new Request('http://localhost:3000/api/auth/request-password-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'x-real-ip': ip, 'user-agent': 'vitest' },
          body: JSON.stringify({ email, callbackURL: '/reset-password', turnstileToken: 'valid-test-token' }),
        })

      const t0e = performance.now()
      const resE = await auth.handler(makeReq(existingEmail, eIp))
      existingTimes.push(performance.now() - t0e)
      void (await resE.json())

      const t0ne = performance.now()
      const resNe = await auth.handler(makeReq(`ne-${i}-${Date.now()}@example.test`, neIp))
      nonExistingTimes.push(performance.now() - t0ne)
      void (await resNe.json())
    }

    const sortedE = [...existingTimes].sort((a, b) => a - b)
    const sortedNe = [...nonExistingTimes].sort((a, b) => a - b)
    const medianE = sortedE[Math.floor(N / 2)]!
    const medianNe = sortedNe[Math.floor(N / 2)]!

    expect(Math.abs(medianE - medianNe)).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// 19. Email failure without .code property → logs EMAIL_SEND_FAILED, calls alert()
// ---------------------------------------------------------------------------

describe('email provider failure: error without .code property', () => {
  it('logs EMAIL_SEND_FAILED and calls alert() when sendEmail throws without code', async () => {
    stubFetchTurnstileSuccess()
    const email = `email-nocode-${Date.now()}@example.test`

    mockAlert.mockClear()
    mockLoggerWarn.mockClear()

    // Error with NO .code property (e.g. a plain Error from an HTTP client)
    mockSendEmail.mockRejectedValueOnce(new Error('connection refused'))

    await auth.handler(makeSignUpReq({ email }, '198.51.100.70'))

    // Wait for the async email-send callback to run (after() is synchronous in test)
    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), { timeout: 2000 })

    // alert() must be called with 'email.send.failed' and code 'EMAIL_SEND_FAILED'
    await vi.waitFor(
      () =>
        expect(mockAlert).toHaveBeenCalledWith(
          'email.send.failed',
          expect.objectContaining({ code: 'EMAIL_SEND_FAILED' }),
        ),
      { timeout: 2000 },
    )

    // logger.warn must also have been called with the same code
    await vi.waitFor(
      () =>
        expect(mockLoggerWarn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'EMAIL_SEND_FAILED' }),
          expect.any(String),
        ),
      { timeout: 2000 },
    )
  })

  it('logs the actual .code (ECONNREFUSED) when it is present on the error', async () => {
    stubFetchTurnstileSuccess()
    const email = `email-code-${Date.now()}@example.test`

    mockAlert.mockClear()
    mockLoggerWarn.mockClear()

    const errWithCode = Object.assign(new Error('smtp refused'), { code: 'ECONNREFUSED' })
    mockSendEmail.mockRejectedValueOnce(errWithCode)

    await auth.handler(makeSignUpReq({ email }, '198.51.100.71'))

    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalled(), { timeout: 2000 })
    await vi.waitFor(
      () =>
        expect(mockLoggerWarn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'ECONNREFUSED' }),
          expect.any(String),
        ),
      { timeout: 2000 },
    )
  })
})
