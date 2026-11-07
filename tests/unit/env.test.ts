import { vi, describe, it, expect } from 'vitest'

// Set SKIP_ENV_VALIDATION before @/env is imported so parseEnv() short-circuits.
// The test calls _envSchema.safeParse() directly — not parseEnv() — so this is safe.
vi.stubEnv('SKIP_ENV_VALIDATION', '1')

const { _envSchema } = await import('@/env')

// Minimal valid env used as a base for schema-level tests.
const BASE = {
  APP_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/db',
  MIGRATE_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/db',
  BETTER_AUTH_SECRET: 'secret',
  BETTER_AUTH_URL: 'http://localhost:3000',
  PII_KEYS: 'v1:' + Buffer.from('a'.repeat(32)).toString('base64'),
  PII_ACTIVE_KEY_ID: 'v1',
  TURNSTILE_SITE_KEY: 'key',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  S3_ENDPOINT: 'http://127.0.0.1:9010',
  S3_REGION: 'ap-southeast-5',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'test@example.test',
  SMTP_URL: 'smtp://127.0.0.1:1025',
}

describe('HEALTHCHECKS_* env vars — empty-string coercion', () => {
  it('empty string is coerced to undefined and passes validation', () => {
    const result = _envSchema.safeParse({
      ...BASE,
      HEALTHCHECKS_EXAMPLE: '',
      HEALTHCHECKS_PRUNE_RATE_LIMIT: '',
    })
    expect(result.success).toBe(true)
    expect(result.data?.HEALTHCHECKS_EXAMPLE).toBeUndefined()
    expect(result.data?.HEALTHCHECKS_PRUNE_RATE_LIMIT).toBeUndefined()
  })

  it('invalid URL fails validation', () => {
    const result = _envSchema.safeParse({ ...BASE, HEALTHCHECKS_EXAMPLE: 'not-a-url' })
    expect(result.success).toBe(false)
  })

  it('valid URL passes and is preserved', () => {
    const url = 'https://hc-ping.com/abc123'
    const result = _envSchema.safeParse({ ...BASE, HEALTHCHECKS_EXAMPLE: url })
    expect(result.success).toBe(true)
    expect(result.data?.HEALTHCHECKS_EXAMPLE).toBe(url)
  })

  it('undefined passes (variable absent in env)', () => {
    const result = _envSchema.safeParse({ ...BASE })
    expect(result.success).toBe(true)
    expect(result.data?.HEALTHCHECKS_EXAMPLE).toBeUndefined()
  })
})

describe('APP_ENV NODE_ENV fallback (M1-T07)', () => {
  const BASE_NO_APP_ENV = (() => {
    const { APP_ENV: _removed, ...rest } = BASE as typeof BASE & { APP_ENV?: string }
    return rest
  })()

  it('defaults to production when NODE_ENV=production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const result = _envSchema.safeParse({ ...BASE_NO_APP_ENV, APP_URL: 'https://example.com', BETTER_AUTH_SECRET: 'a'.repeat(32), TURNSTILE_SECRET_KEY: 'prod-key' })
    expect(result.success).toBe(true)
    expect(result.data?.APP_ENV).toBe('production')
    vi.unstubAllEnvs()
  })

  it('defaults to ci when NODE_ENV=test', () => {
    vi.stubEnv('NODE_ENV', 'test')
    const result = _envSchema.safeParse({ ...BASE_NO_APP_ENV })
    expect(result.success).toBe(true)
    expect(result.data?.APP_ENV).toBe('ci')
    vi.unstubAllEnvs()
  })

  it('defaults to development when NODE_ENV is absent', () => {
    vi.stubEnv('NODE_ENV', '')
    const result = _envSchema.safeParse({ ...BASE_NO_APP_ENV })
    expect(result.success).toBe(true)
    expect(result.data?.APP_ENV).toBe('development')
    vi.unstubAllEnvs()
  })
})
