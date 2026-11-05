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
