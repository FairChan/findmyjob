/**
 * MA1-T03 at the Better Auth hook level: an integrityToken replaces Turnstile only for requests
 * from the configured app origin while Play Integrity is configured; everything else still needs
 * Turnstile. Uses the real auth.handler; Play Integrity itself is mocked (covered separately).
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const APP = 'findmyjob-dev://'
const mockEnv = vi.hoisted(() => ({
  APP_URL: 'http://localhost:3000',
  APP_ENV: 'ci' as const,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? ['ci', 'int', 'test', 'secret'].join('-').padEnd(32, '!'),
  BETTER_AUTH_URL: 'http://localhost:3000',
  PII_KEYS: process.env.PII_KEYS ?? ('v1:' + Buffer.from('a'.repeat(32)).toString('base64')),
  PII_ACTIVE_KEY_ID: 'v1',
  MOBILE_APP_ORIGINS: 'findmyjob-dev://',
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
  EMAIL_VERIFICATION_PROVIDER: 'smtp' as const,
  EMAIL_FROM: 'test@example.test',
  LOG_LEVEL: 'info' as const,
  HSTS_MAX_AGE: 300,
}))
vi.mock('@/env', () => ({ env: mockEnv }))
vi.mock('next/server', () => ({ after: vi.fn((fn: () => Promise<unknown>) => { void fn().catch(() => {}) }) }))
vi.mock('@/lib/email', () => ({ createEmailProvider: () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }) }))
vi.mock('@/server/lib/alert', () => ({ alert: vi.fn() }))
vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers({ 'x-real-ip': '10.9.0.1' })),
  cookies: vi.fn(() => ({ set: vi.fn() })),
}))
vi.mock('@/server/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  pinoOptions: {},
}))

const pi = vi.hoisted(() => ({ configured: true, verify: vi.fn() }))
vi.mock('@/server/lib/play-integrity', async (orig) => {
  const real = await orig<typeof import('@/server/lib/play-integrity')>()
  return { ...real, isPlayIntegrityConfigured: () => pi.configured, verifyPlayIntegrity: pi.verify }
})

import { setupTestDb } from '../setup/db'
import { auth } from '@/server/auth'
import { PlayIntegrityError } from '@/server/lib/play-integrity'

setupTestDb()

let ip = 0
function signIn(headers: Record<string, string>, body: Record<string, unknown>) {
  return new Request('http://localhost:3000/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': `10.9.1.${++ip}`, ...headers },
    body: JSON.stringify({ email: 'Nobody@Example.test', password: 'Password123!', ...body }),
  })
}
async function code(res: Response) {
  return ((await res.json().catch(() => ({}))) as { code?: string }).code
}

beforeEach(() => {
  vi.stubEnv('MOBILE_APP_ORIGINS', APP)
  pi.configured = true
  pi.verify.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('Play Integrity in the auth before-hook', () => {
  it('app origin + valid integrity token passes the bot check without Turnstile', async () => {
    const res = await auth.handler(signIn({ 'expo-origin': APP }, { integrityToken: 'tok' }))
    expect(await code(res)).not.toBe('TURNSTILE_FAILED')
    expect(pi.verify).toHaveBeenCalledWith('tok', { action: 'login', email: 'Nobody@Example.test' })
  })

  it('a rejected integrity verdict is TURNSTILE_FAILED (no silent fallback in the same request)', async () => {
    pi.verify.mockRejectedValue(new PlayIntegrityError('device'))
    const res = await auth.handler(signIn({ 'expo-origin': APP }, { integrityToken: 'tok', turnstileToken: '' }))
    expect(res.status).toBe(400)
    expect(await code(res)).toBe('TURNSTILE_FAILED')
  })

  it('a browser cannot use an integrity token instead of Turnstile', async () => {
    const res = await auth.handler(signIn({ origin: 'http://localhost:3000' }, { integrityToken: 'tok' }))
    expect(res.status).toBe(400)
    expect(await code(res)).toBe('TURNSTILE_FAILED')
    expect(pi.verify).not.toHaveBeenCalled()
  })

  it('a look-alike app scheme cannot use it either', async () => {
    const res = await auth.handler(signIn({ 'expo-origin': 'findmyjob-dev-evil://' }, { integrityToken: 'tok' }))
    expect(pi.verify).not.toHaveBeenCalled()
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('when Play Integrity is not configured the app falls back to Turnstile', async () => {
    pi.configured = false
    let res = await auth.handler(signIn({ 'expo-origin': APP }, { integrityToken: 'tok' }))
    expect(await code(res)).toBe('TURNSTILE_FAILED')
    res = await auth.handler(signIn({ 'expo-origin': APP }, { turnstileToken: 'webview-token' }))
    expect(await code(res)).not.toBe('TURNSTILE_FAILED')
    expect(pi.verify).not.toHaveBeenCalled()
  })
})
