import { randomBytes, randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { hashPassword } from 'better-auth/crypto'
import { totpCode } from '../lib/totp'
import { uniqueClientIp } from './helpers/client-ip'
import { writeCurrentVersionConsent } from './helpers/consent'
import { e2eDb as db } from './helpers/db'
import { stubTurnstile } from './helpers/turnstile'

// Enrollment intentionally renders a secret and backup codes. Do not retain
// screenshots, video, or trace snapshots of these synthetic credentials.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

const createdUserIds: string[] = []

test.afterEach(async () => {
  await db.user.deleteMany({ where: { id: { in: createdUserIds.splice(0) } } })
})

async function createAdmin(page: Page) {
  const userId = randomUUID()
  const email = `e2e-two-factor-${userId}@example.test`
  const password = randomBytes(24).toString('hex')
  await db.user.create({
    data: {
      id: userId,
      name: 'Synthetic 2FA Admin',
      email,
      emailVerified: true,
      role: 'ADMIN',
      accounts: {
        create: {
          accountId: userId,
          providerId: 'credential',
          password: await hashPassword(password),
        },
      },
    },
  })
  createdUserIds.push(userId)
  await writeCurrentVersionConsent(userId)
  await page.setExtraHTTPHeaders({ 'x-real-ip': uniqueClientIp() })
  await stubTurnstile(page)
  return { userId, email, password }
}

async function passwordSignIn(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/zh/login')
  await page.locator('[name="email"]').fill(credentials.email)
  await page.locator('[name="password"]').fill(credentials.password)
  const submit = page.locator('button[type="submit"]')
  await expect(submit).toBeEnabled({ timeout: 15_000 })
  await submit.click()
}

async function setUpTwoFactor(page: Page, password: string, checkRetry = false): Promise<string> {
  await expect(page).toHaveURL(/\/zh\/two-factor\/setup(?:\?|$)/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: '设置双重验证' })).toBeVisible()
  if (checkRetry) {
    await page.locator('#setup-password').fill('incorrect-password')
    await page.getByRole('button', { name: '生成验证密钥', exact: true }).click()
    await expect(page.locator('p[role="alert"]')).toHaveText('当前密码不正确。')
    await expect(page.locator('#setup-password')).toBeEnabled()
  }
  await page.locator('#setup-password').fill(password)
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/two-factor/enable',
  )
  await page.getByRole('button', { name: '生成验证密钥', exact: true }).click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  const setup = await response.json() as { totpURI?: string }
  if (!setup.totpURI) throw new Error('2FA enrollment did not return a TOTP URI')

  await expect(page.locator('#two-factor-secret')).toHaveAttribute('readonly', '')
  await expect(page.getByRole('list', { name: '备用码', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  const verify = page.getByRole('button', { name: '验证并进入后台', exact: true })
  await page.locator('#setup-code').fill(await totpCode(setup.totpURI))
  await expect(verify).toBeDisabled()
  await page.locator('#backup-codes-saved').check()
  await expect(verify).toBeEnabled({ timeout: 10_000 })
  if (checkRetry) {
    await page.route('**/api/auth/two-factor/verify-totp', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      await route.continue({ postData: JSON.stringify({ ...body, code: 'invalid-totp' }) })
    }, { times: 1 })
    await verify.click()
    await expect(page.locator('p[role="alert"]')).toHaveText('验证码错误或已过期，请输入当前验证码重试。')
    await expect(page.locator('#setup-code')).toBeEnabled()
    await page.locator('#setup-code').fill(await totpCode(setup.totpURI))
  }
  await verify.click()
  await expect(page).toHaveURL(/\/zh\/admin$/, { timeout: 20_000 })
  return setup.totpURI
}

async function signOut(page: Page) {
  const response = await page.request.post('/api/auth/sign-out', {
    headers: { origin: new URL(page.url()).origin },
    data: {},
  })
  expect(response.status()).toBe(200)
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1,
  )).toBe(true)
}

test.describe('M6-T09 mandatory admin two-factor authentication', () => {
  for (const width of [375, 1280]) {
    test(`ADMIN must enroll and complete a second login challenge at ${width}px`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.setViewportSize({ width, height: 900 })
      const admin = await createAdmin(page)
      await passwordSignIn(page, admin)
      await expect(page).toHaveURL(/\/zh\/two-factor\/setup(?:\?|$)/, { timeout: 20_000 })
      await expectNoHorizontalOverflow(page)

      // Direct admin navigation must keep an unenrolled account at setup.
      await page.goto('/zh/admin')
      await expect(page).toHaveURL(/\/zh\/two-factor\/setup(?:\?|$)/, { timeout: 20_000 })
      const totpURI = await setUpTwoFactor(page, admin.password, width === 375)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page)

      await signOut(page)
      await passwordSignIn(page, admin)
      await expect(page.locator('#two-factor-code')).toBeVisible({ timeout: 15_000 })
      await expect(page).toHaveURL(/\/zh\/login$/)
      const pendingSession = await page.request.get('/api/auth/get-session')
      expect((await pendingSession.json()) === null).toBe(true)
      await expectNoHorizontalOverflow(page)

      await page.locator('#two-factor-code').fill(await totpCode(totpURI))
      await page.getByRole('button', { name: '验证并登录', exact: true }).click()
      await expect(page).toHaveURL(/\/zh\/admin$/, { timeout: 20_000 })
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    })
  }

  test('five rejected TOTP attempts rate-limit the next attempt', async ({ page }) => {
    test.setTimeout(90_000)
    const admin = await createAdmin(page)
    await passwordSignIn(page, admin)
    await setUpTwoFactor(page, admin.password)
    await signOut(page)
    // Enrollment's successful verification should not consume this login's
    // five-request bucket; every failed attempt below keeps the same client IP.
    await page.setExtraHTTPHeaders({ 'x-real-ip': uniqueClientIp() })
    await passwordSignIn(page, admin)
    await expect(page.locator('#two-factor-code')).toBeVisible({ timeout: 15_000 })

    // Ensure every submitted value is wrong even if 000000 happens to be the
    // current code. Requests still reach Better Auth's real verification handler.
    await page.route('**/api/auth/two-factor/verify-totp', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      await route.continue({ postData: JSON.stringify({ ...body, code: 'invalid-totp' }) })
    })
    for (let attempt = 1; attempt <= 6; attempt++) {
      await page.locator('#two-factor-code').fill('000000')
      const verify = page.getByRole('button', { name: '验证并登录', exact: true })
      await expect(verify).toBeEnabled({ timeout: 10_000 })
      const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/auth/two-factor/verify-totp',
      )
      await verify.click()
      const response = await responsePromise
      expect(response.status()).toBe(attempt <= 5 ? 401 : 429)
    }
    await expect(page.locator('p[role="alert"]')).toContainText('登录失败次数过多，请稍后再试')
    await expect(page).toHaveURL(/\/zh\/login$/)
    const session = await page.request.get('/api/auth/get-session')
    expect((await session.json()) === null).toBe(true)
  })
})
