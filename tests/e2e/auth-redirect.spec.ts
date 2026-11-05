/**
 * M1-T01 / M1-T04 E2E：学生注册 → Mailpit 收验证邮件 → 验证 → 登录 → 进入 /s/onboarding → 登出 → 会话失效
 *
 * 需要 Mailpit：本地 `docker compose up -d mailpit`（宿主机 1026/8026），CI 的 e2e job 有同端口的 service。
 * 没有 Mailpit 或收不到邮件时直接失败，不 skip：否则 verify 全绿可能只是跳过了。
 */
import { test, expect } from '@playwright/test'

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8026'

test.describe('Turnstile widget UX', () => {
  test('submit button is disabled until Turnstile token loads', async ({ page }) => {
    await page.goto('/zh/register/student')
    // Before the token arrives the button must be disabled
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
    // After the token arrives the button is enabled
    await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('', { timeout: 15000 })
    await expect(page.locator('button[type="submit"]')).toBeEnabled()
  })

  test('TURNSTILE_FAILED shows specific error message, not generic "邮箱或密码错误"', async ({ page }) => {
    await page.goto('/zh/login')
    // Wait for Turnstile token so the button is enabled
    await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('', { timeout: 15000 })
    // Corrupt the hidden token so the server rejects it
    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')
      if (el) el.value = 'INVALID_TOKEN_FOR_TEST'
    })
    await page.fill('[name="email"]', 'any@example.test')
    await page.fill('[name="password"]', 'Password123!')
    await page.click('button[type="submit"]')

    // Should show Turnstile-specific error, NOT the generic credentials error
    await expect(page.getByRole('alert')).toContainText('人机验证失败', { timeout: 10000 })
    await expect(page.getByRole('alert')).not.toContainText('邮箱或密码错误')
  })
})

test.describe('student registration → verification → login → sign-out', () => {
  test('new student reaches /s/onboarding, then sign-out invalidates the session', async ({ page, request }) => {
    const mailpitCheck = await request.get(`${MAILPIT_URL}/api/v1/messages`).catch(() => null)
    expect(
      mailpitCheck?.ok(),
      `Mailpit is not reachable at ${MAILPIT_URL} (run: docker compose up -d mailpit)`,
    ).toBe(true)

    const unique = Date.now()
    const email = `e2e-student-${unique}@example.test`
    const password = 'Password123!'

    // --- Step 1: Register ---
    await page.goto('/zh/register/student')
    await page.fill('[name="name"]', `E2E Student ${unique}`)
    await page.fill('[name="email"]', email)
    await page.fill('[name="password"]', password)
    await page.check('[name="agreeTerms"]')
    await page.check('[name="agreePrivacy"]')
    // Turnstile 异步发 token（测试密钥也要先加载 Cloudflare 脚本）；token 到了再提交
    await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('', { timeout: 15000 })
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(/\/register\/verify-email/)

    // --- Step 2: Fetch the verification link from Mailpit (up to 15 seconds) ---
    let verificationUrl: string | null = null
    for (let i = 0; i < 15 && !verificationUrl; i++) {
      await page.waitForTimeout(1000)
      const response = await request.get(`${MAILPIT_URL}/api/v1/messages`)
      if (!response.ok()) continue

      const data = await response.json()
      const messages: Array<{ ID: string; To: Array<{ Address: string }> }> = data.messages ?? []
      const msg = messages.find((m) => m.To.some((r) => r.Address === email))
      if (!msg) continue

      const bodyResp = await request.get(`${MAILPIT_URL}/api/v1/message/${msg.ID}`)
      if (!bodyResp.ok()) continue
      const bodyData = await bodyResp.json()
      const html: string = bodyData.HTML ?? bodyData.Text ?? ''

      const match =
        html.match(/href="([^"]*verify-email[^"]*)"/) ??
        html.match(/(https?:\/\/[^\s<>"]*verify-email[^\s<>"]*)/i)
      if (match) verificationUrl = match[1].replace(/&amp;/g, '&')
    }
    expect(verificationUrl, `no verification email for ${email} arrived in Mailpit within 15 seconds`).not.toBeNull()

    // --- Step 3: Verify ---
    await page.goto(verificationUrl!)
    await page.waitForURL(/.*/, { timeout: 5000 }).catch(() => {})

    // --- Step 4: Log in ---
    await page.goto('/zh/login')
    await expect(page.locator('h1')).toContainText('登录')
    await page.fill('[name="email"]', email)
    await page.fill('[name="password"]', password)
    await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('', { timeout: 15000 })
    await page.click('button[type="submit"]')

    // --- Step 5: Lands on /s/onboarding ---
    await expect(page).toHaveURL(/\/s\/onboarding/, { timeout: 10000 })

    const sessionBefore = await page.request.get('/api/auth/get-session')
    expect((await sessionBefore.json())?.user?.email).toBe(email)
    const sessionCookies = (await page.context().cookies()).filter((c) =>
      c.name.endsWith('better-auth.session_token'),
    )
    expect(sessionCookies.length).toBeGreaterThan(0)

    // --- Step 6: Sign out ---
    await page.goto('/zh/s/settings')
    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page).toHaveURL(/\/zh\/login/, { timeout: 10000 })

    // --- Step 7: The session is gone ---
    await page.goto('/zh/s')
    await expect(page).toHaveURL(/\/zh\/login\?redirect=%2Fzh%2Fs/)

    // 把登出前的 cookie 塞回去，服务端也必须认为会话已失效（不只是浏览器删了 cookie）
    await page.context().addCookies(sessionCookies)
    const sessionAfter = await page.request.get('/api/auth/get-session')
    expect(await sessionAfter.json()).toBeNull()
  })
})
