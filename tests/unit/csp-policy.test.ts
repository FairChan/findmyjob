import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildContentSecurityPolicy } from '@/lib/csp'

const NONCE = 'syntheticCspNonce1234567890'
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(';').map((directive) => directive.trim()).filter(Boolean).map((directive) => {
      const [name, ...sources] = directive.split(/\s+/)
      return [name, sources]
    }),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildContentSecurityPolicy', () => {
  it('allows only nonce-trusted scripts and Turnstile in production, without eval or inline exemptions', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const policy = buildContentSecurityPolicy({ nonce: NONCE, appEnv: 'production' })

    expect(directives(policy)['script-src']).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
      "'strict-dynamic'",
      TURNSTILE_ORIGIN,
    ])
    expect(policy).not.toContain("'unsafe-eval'")
    expect(directives(policy)['script-src']).not.toContain("'unsafe-inline'")
  })

  it.each(['development', 'staging', 'ci'] as const)(
    'allows development eval for APP_ENV=%s even when NODE_ENV is production',
    (appEnv) => {
      vi.stubEnv('NODE_ENV', 'production')
      const policy = buildContentSecurityPolicy({ nonce: NONCE, appEnv })

      expect(directives(policy)['script-src']).toEqual(expect.arrayContaining([
        "'self'",
        `'nonce-${NONCE}'`,
        "'strict-dynamic'",
        TURNSTILE_ORIGIN,
        "'unsafe-eval'",
      ]))
      expect(directives(policy)['script-src']).not.toContain("'unsafe-inline'")
    },
  )

  it('restricts frames and connections while retaining current styles, images and reporting', () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, appEnv: 'production' })

    expect(directives(policy)).toMatchObject({
      'default-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'connect-src': ["'self'", TURNSTILE_ORIGIN],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'"],
      'frame-src': [TURNSTILE_ORIGIN],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'report-uri': ['/api/csp-report'],
    })
    expect(directives(policy)).not.toHaveProperty('upgrade-insecure-requests')
  })

  it.each([
    ['https://public-key:private-key@o42.ingest.sentry.io/12345?token=synthetic-token#fragment', 'https://o42.ingest.sentry.io'],
    ['http://public-key@127.0.0.1:9000/12345', 'http://127.0.0.1:9000'],
  ])('allows only the exact origin from a configured Sentry DSN: %s', (sentryDsn, origin) => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, appEnv: 'production', sentryDsn })

    expect(directives(policy)['connect-src']).toEqual(["'self'", TURNSTILE_ORIGIN, origin])
    expect(policy).not.toContain('public-key')
    expect(policy).not.toContain('private-key')
    expect(policy).not.toContain('/12345')
    expect(policy).not.toContain('synthetic-token')
    expect(policy).not.toContain('#fragment')
  })

  it.each([
    '',
    'not-a-url',
    '/relative-dsn',
    'https://',
    'javascript:alert(1)',
    'data:text/plain,synthetic-dsn',
    'ftp://public-key@sentry.example/12345',
    'ws://sentry.example/12345',
    'blob:https://sentry.example/synthetic-id',
  ])('ignores an invalid or non-HTTP Sentry DSN: %s', (sentryDsn) => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, appEnv: 'production', sentryDsn })

    expect(directives(policy)['connect-src']).toEqual(["'self'", TURNSTILE_ORIGIN])
  })
})
