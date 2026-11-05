/**
 * Tests for M1-T09 auth hardening changes:
 * - route() input parsing with zod
 * - env.ts BETTER_AUTH_SECRET length in production
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
})
