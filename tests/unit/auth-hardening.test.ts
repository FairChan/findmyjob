/**
 * Tests for M1-T09/T11 auth hardening changes:
 * - route() input parsing with zod
 * - env.ts BETTER_AUTH_SECRET length in production
 * - route() returns 400 on malformed JSON body
 */
import { vi, describe, it, expect } from 'vitest'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// route() — input parsing
// ---------------------------------------------------------------------------

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))

const { route } = await import('@/server/route')

function makeGetRequest(url: string): Request {
  return new Request(url, { method: 'GET', headers: { origin: 'http://localhost:3000' } })
}

function makePostRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  })
}

describe('route() input parsing', () => {
  it('passes parsed query params to handler for GET when input schema provided', async () => {
    const schema = z.object({ page: z.coerce.number().int().min(1) })
    let capturedInput: unknown = undefined

    const handler = route({ auth: 'public', input: schema }, async (_req, ctx) => {
      capturedInput = ctx.input
      return new Response('ok')
    })

    await handler(makeGetRequest('http://localhost/api/test?page=2'))
    expect(capturedInput).toEqual({ page: 2 })
  })

  it('returns 400 for GET request with invalid query params', async () => {
    const schema = z.object({ page: z.coerce.number().int().min(1) })

    const handler = route({ auth: 'public', input: schema }, async () => new Response('ok'))
    const res = await handler(makeGetRequest('http://localhost/api/test?page=-1'))
    expect(res.status).toBe(400)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('passes parsed JSON body to handler for POST when input schema provided', async () => {
    const schema = z.object({ name: z.string().min(1) })
    let capturedInput: unknown = undefined

    const handler = route({ auth: 'public', input: schema }, async (_req, ctx) => {
      capturedInput = ctx.input
      return new Response('ok')
    })

    await handler(makePostRequest('http://localhost/api/test', { name: 'Alice' }))
    expect(capturedInput).toEqual({ name: 'Alice' })
  })

  it('returns 400 for POST with invalid JSON body', async () => {
    const schema = z.object({ name: z.string().min(1) })
    const handler = route({ auth: 'public', input: schema }, async () => new Response('ok'))
    const res = await handler(makePostRequest('http://localhost/api/test', { name: '' }))
    expect(res.status).toBe(400)
  })

  it('handler receives undefined input when no schema provided', async () => {
    let capturedInput: unknown = 'NOT_SET'
    const handler = route({ auth: 'public' }, async (_req, ctx) => {
      capturedInput = ctx.input
      return new Response('ok')
    })
    await handler(makeGetRequest('http://localhost/api/test'))
    expect(capturedInput).toBeUndefined()
  })

  it('returns 400 INVALID_JSON for malformed JSON body', async () => {
    const schema = z.object({ name: z.string() })
    const handler = route({ auth: 'public', input: schema }, async () => new Response('ok'))
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000' },
      body: 'not-json{{{',
    })
    const res = await handler(req)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('INVALID_JSON')
  })
})

// ---------------------------------------------------------------------------
// env.ts — BETTER_AUTH_SECRET production validation
// ---------------------------------------------------------------------------

describe('env.ts BETTER_AUTH_SECRET production check', () => {
  it('throws when APP_ENV=production and BETTER_AUTH_SECRET is shorter than 32 chars', async () => {
    const savedSkip = process.env.SKIP_ENV_VALIDATION
    const savedEnv = { ...process.env }
    try {
      delete process.env.SKIP_ENV_VALIDATION
      Object.assign(process.env, {
        APP_ENV: 'production',
        APP_URL: 'https://example.com',
        BETTER_AUTH_SECRET: 'tooshort',
        BETTER_AUTH_URL: 'https://example.com',
        DATABASE_URL: 'postgresql://findmyjob_app:x@localhost:5432/findmyjob',
        MIGRATE_DATABASE_URL: 'postgresql://findmyjob_app:x@localhost:5432/findmyjob',
        PII_KEYS: 'v1:' + Buffer.from('a'.repeat(32)).toString('base64'),
        PII_ACTIVE_KEY_ID: 'v1',
        TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
        TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
        S3_ENDPOINT: 'https://s3.example.com',
        S3_REGION: 'ap-southeast-1',
        S3_BUCKET: 'bucket',
        S3_ACCESS_KEY_ID: 'keyid',
        S3_SECRET_ACCESS_KEY: 'test-s3-key',
        EMAIL_PROVIDER: 'smtp',
        EMAIL_FROM: 'noreply@example.com',
        SMTP_URL: 'smtp://localhost:1025',
        LOG_LEVEL: 'info',
      })
      vi.resetModules()
      await expect(import('@/env')).rejects.toThrow(/BETTER_AUTH_SECRET must be at least 32 characters/)
    } finally {
      vi.resetModules()
      // Restore SKIP_ENV_VALIDATION and any keys we added
      Object.keys(process.env).forEach(k => { if (!(k in savedEnv)) delete process.env[k] })
      Object.assign(process.env, savedEnv)
      if (savedSkip === undefined) delete process.env.SKIP_ENV_VALIDATION
      else process.env.SKIP_ENV_VALIDATION = savedSkip
    }
  })
})
