import { vi, describe, it, expect, afterEach } from 'vitest'

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('next/server', () => ({ after: vi.fn((fn: () => Promise<unknown>) => { void fn().catch(() => {}) }) }))
vi.mock('@/lib/email', () => ({ createEmailProvider: () => ({ sendEmail }) }))
vi.mock('@/server/lib/turnstile', () => ({ verifyTurnstile: vi.fn(), TurnstileError: class extends Error {} }))

import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { setupTestDb, testDb } from '../setup/db'
import { auth, getSession } from '@/server/auth'
import { requireAdmin } from '@/server/authz'
import { totpCode } from '../lib/totp'

setupTestDb()
afterEach(() => vi.clearAllMocks())

const origin = process.env.APP_URL!
const password = randomUUID()
let nextIp = 0

function client() {
  const cookies = new Map<string, string>()
  const ip = `198.19.10.${++nextIp}`
  const headers = () => new Headers({ origin, 'content-type': 'application/json', 'x-real-ip': ip,
    cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') })
  return {
    headers,
    async post(path: string, body: unknown) {
      const response = await auth.handler(new Request(`${origin}/api/auth${path}`, {
        method: 'POST', headers: headers(), body: JSON.stringify(body),
      }))
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0]!
        const index = pair.indexOf('=')
        cookies.set(pair.slice(0, index), pair.slice(index + 1))
      }
      return response
    },
  }
}

async function createAdmin() {
  const user = await testDb.user.create({ data: {
    name: 'Synthetic Admin', email: `${randomUUID()}@example.test`,
    emailVerified: true, role: 'ADMIN',
  } })
  await testDb.account.create({ data: {
    userId: user.id, accountId: user.id, providerId: 'credential', password: await hashPassword(password),
  } })
  return user
}

async function enroll() {
  const admin = await createAdmin()
  const browser = client()
  expect((await browser.post('/sign-in/email', { email: admin.email, password, turnstileToken: 'test' })).status).toBe(200)
  const response = await browser.post('/two-factor/enable', { password, method: 'totp' })
  expect(response.status).toBe(200)
  const enrollment = await response.json() as { totpURI: string; backupCodes: string[] }
  expect((await browser.post('/two-factor/verify-totp', { code: await totpCode(enrollment.totpURI) })).status).toBe(200)
  return { admin, browser, ...enrollment }
}

describe('admin two-factor authentication with real Better Auth', () => {
  it('requires setup before admin access and returns enrollment data only after password confirmation', async () => {
    const admin = await createAdmin()
    const browser = client()
    const login = await browser.post('/sign-in/email', { email: admin.email, password, turnstileToken: 'test' })
    expect(login.status).toBe(200)
    await expect(requireAdmin(browser.headers())).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' })
    const rejected = await browser.post('/two-factor/enable', { password: 'incorrect' })
    expect(rejected.status).toBe(400)
    const enabled = await browser.post('/two-factor/enable', { password })
    expect(enabled.status).toBe(200)
    const body = await enabled.json()
    expect(body.totpURI).toMatch(/^otpauth:\/\/totp\//)
    expect(body.backupCodes).toHaveLength(10)
  })

  it('only grants admin access after a real TOTP challenge and never trusts the device', async () => {
    const { admin, browser: first, totpURI, backupCodes } = await enroll()
    expect(await requireAdmin(first.headers())).toEqual({ userId: admin.id })
    const stored = await testDb.twoFactor.findFirstOrThrow({ where: { userId: admin.id } })
    expect(stored.secret).not.toContain(new URL(totpURI).searchParams.get('secret'))
    expect(stored.backupCodes).not.toContain(backupCodes[0])

    const browser = client()
    const signedIn = await browser.post('/sign-in/email', { email: admin.email, password, turnstileToken: 'test' })
    expect(await signedIn.json()).toMatchObject({ twoFactorRedirect: true })
    await expect(requireAdmin(browser.headers())).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const verified = await browser.post('/two-factor/verify-totp', { code: await totpCode(totpURI), trustDevice: true })
    expect(verified.status).toBe(200)
    expect(verified.headers.getSetCookie().some((cookie) => cookie.includes('trust_device'))).toBe(false)
    expect(await requireAdmin(browser.headers(), { fresh: true })).toEqual({ userId: admin.id })
    const session = await auth.api.getSession({ headers: browser.headers() })
    const row = await testDb.session.findUniqueOrThrow({ where: { id: session!.session.id } })
    expect(row.twoFactorVerifiedAt).not.toBeNull()
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(12 * 3_600_000)
    const changed = await browser.post('/update-session', { twoFactorVerifiedAt: new Date().toISOString() })
    expect(changed.status).toBe(400)
  })

  it('locks after five wrong TOTP codes even when a fresh login challenge uses another IP', async () => {
    const { admin, totpURI } = await enroll()
    const browser = client()
    expect((await browser.post('/sign-in/email', { email: admin.email, password, turnstileToken: 'test' })).status).toBe(200)
    // A non-numeric code can never be a valid TOTP, including at a time-step boundary.
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await browser.post('/two-factor/verify-totp', { code: 'xxxxxx' })).status).toBe(401)
    }
    const limited = await browser.post('/two-factor/verify-totp', { code: await totpCode(totpURI) })
    expect(limited.status).toBe(429)
    const otherIp = client()
    expect((await otherIp.post('/sign-in/email', { email: admin.email, password, turnstileToken: 'test' })).status).toBe(200)
    const locked = await otherIp.post('/two-factor/verify-totp', { code: await totpCode(totpURI) })
    expect(locked.status).toBe(429)
    expect(await locked.json()).toMatchObject({ code: 'ACCOUNT_TEMPORARILY_LOCKED' })
  })

  it('accepts a backup code once and rejects its replay', async () => {
    const { admin, backupCodes } = await enroll()
    const browser = client()
    await browser.post('/sign-in/email', { email: admin.email, password, turnstileToken: 'test' })
    expect((await browser.post('/two-factor/verify-backup-code', { code: backupCodes[0] })).status).toBe(200)
    expect(await requireAdmin(browser.headers())).toEqual({ userId: admin.id })
    const replay = client()
    await replay.post('/sign-in/email', { email: admin.email, password, turnstileToken: 'test' })
    expect((await replay.post('/two-factor/verify-backup-code', { code: backupCodes[0] })).status).toBe(401)
  })

  it('prevents an old password-only session from becoming admin when another session enables 2FA', async () => {
    const admin = await createAdmin()
    const old = client()
    await old.post('/sign-in/email', { email: admin.email, password, turnstileToken: 'test' })
    const setup = client()
    await setup.post('/sign-in/email', { email: admin.email, password, turnstileToken: 'test' })
    const response = await setup.post('/two-factor/enable', { password, method: 'totp' })
    expect(response.status).toBe(200)
    const { totpURI } = await response.json()
    expect((await setup.post('/two-factor/verify-totp', { code: await totpCode(totpURI) })).status).toBe(200)
    await expect(requireAdmin(old.headers())).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('does not renew an admin session beyond twelve hours', async () => {
    const { admin, browser } = await enroll()
    const session = await auth.api.getSession({ headers: browser.headers() })
    const createdAt = new Date(Date.now() - 13 * 3_600_000)
    await testDb.session.update({ where: { id: session!.session.id }, data: {
      createdAt, updatedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
    } })
    await expect(requireAdmin(browser.headers())).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await testDb.user.findUniqueOrThrow({ where: { id: admin.id } })).twoFactorEnabled).toBe(true)
  })

  it.each(['/update-user', '/update-user?disableRefresh=true', '/change-password'])('rejects the first core auth mutation from a legacy admin session (%s)', async (path) => {
    const { admin, browser, totpURI } = await enroll()
    const session = await auth.api.getSession({ headers: browser.headers() })
    await testDb.session.update({ where: { id: session!.session.id }, data: {
      createdAt: new Date(Date.now() - 13 * 3_600_000),
      expiresAt: new Date(Date.now() + 6 * 86_400_000),
      updatedAt: new Date(),
    } })
    const credential = await testDb.account.findFirstOrThrow({ where: { userId: admin.id } })
    const sessions = await testDb.session.count({ where: { userId: admin.id } })
    const result = await browser.post(path, {
      name: 'Must not change', currentPassword: password, newPassword: randomUUID(),
    })
    expect(result.status).toBe(401)
    expect((await testDb.user.findUniqueOrThrow({ where: { id: admin.id } })).name).toBe('Synthetic Admin')
    expect((await testDb.account.findUniqueOrThrow({ where: { id: credential.id } })).password === credential.password).toBe(true)
    expect(await testDb.session.count({ where: { userId: admin.id } })).toBe(sessions)
    expect(await getSession(browser.headers())).toBeNull()
    await expect(requireAdmin(browser.headers())).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Expiry must not prevent the owner from starting a new password + TOTP login.
    expect((await browser.post('/sign-in/email', { email: admin.email, password, turnstileToken: 'test' })).status).toBe(200)
    expect((await browser.post('/two-factor/verify-totp', { code: await totpCode(totpURI) })).status).toBe(200)
    expect(await requireAdmin(browser.headers())).toEqual({ userId: admin.id })
    expect((await browser.post('/sign-out', {})).status).toBe(200)
  })

  it('does not write a sliding refresh on every admin session read', async () => {
    const { browser } = await enroll()
    const session = await auth.api.getSession({ headers: browser.headers() })
    const updatedAt = new Date(Date.now() - 60_000)
    await testDb.session.update({ where: { id: session!.session.id }, data: { updatedAt } })
    await auth.api.getSession({ headers: browser.headers() })
    expect((await testDb.session.findUniqueOrThrow({ where: { id: session!.session.id } })).updatedAt).toEqual(updatedAt)
  })

  it('still refreshes student sessions after an admin request', async () => {
    const { browser: adminBrowser } = await enroll()
    const student = await createAdmin()
    await testDb.user.update({ where: { id: student.id }, data: { role: 'STUDENT' } })
    const browser = client()
    await browser.post('/sign-in/email', { email: student.email, password, turnstileToken: 'test' })
    const session = await auth.api.getSession({ headers: browser.headers() })
    const expiresAt = new Date(Date.now() + 86_400_000)
    await testDb.session.update({ where: { id: session!.session.id }, data: {
      createdAt: new Date(Date.now() - 6 * 86_400_000),
      updatedAt: new Date(Date.now() - 2 * 86_400_000), expiresAt,
    } })
    await auth.api.getSession({ headers: adminBrowser.headers() })
    await browser.post('/update-user', { name: 'Refreshed student' })
    expect((await testDb.session.findUniqueOrThrow({ where: { id: session!.session.id } })).expiresAt.getTime()).toBeGreaterThan(expiresAt.getTime())
  })

  it('lets an expired admin session follow the real password-reset email link', async () => {
    const { admin, browser } = await enroll()
    const session = await auth.api.getSession({ headers: browser.headers() })
    await testDb.session.update({ where: { id: session!.session.id }, data: {
      createdAt: new Date(Date.now() - 13 * 3_600_000), expiresAt: new Date(Date.now() + 86_400_000),
    } })
    expect((await browser.post('/request-password-reset', {
      email: admin.email, redirectTo: `${origin}/zh/reset-password`, turnstileToken: 'test',
    })).status).toBe(200)
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalled())
    const link = (sendEmail.mock.calls.at(-1)![0] as { text: string }).text.match(/https?:\/\/\S+/)?.[0]
    if (!link) throw new Error('Reset email must contain a link')
    const response = await auth.handler(new Request(link, { headers: browser.headers() }))
    expect(response.status).toBe(302)
    const token = new URL(link).pathname.split('/').at(-1)!
    expect(response.headers.get('location')?.includes(token)).toBe(true)
    expect((await browser.post('/reset-password', { token, newPassword: randomUUID() })).status).toBe(200)
  })
})
