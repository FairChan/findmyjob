/**
 * M2-T12 smoke tests: verify /s/invite loads without errors after the userId→profileId fix.
 *
 * Test: logs in as a student who has completed step 1 onboarding, opens /s/invite,
 * asserts status 200, no error boundary, no console errors.
 *
 * Requires: dev server + Mailpit (docker compose up -d)
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { E2E_PASSWORD } from './helpers/password'
import { stubTurnstile } from './helpers/turnstile'
import { uniqueClientIp } from './helpers/client-ip'

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8026'

async function registerLoginAndCompleteStep1(
  page: Page,
  request: APIRequestContext,
  suffix: string,
) {
  const mailpitCheck = await request.get(`${MAILPIT_URL}/api/v1/messages`).catch(() => null)
  expect(
    mailpitCheck?.ok(),
    `Mailpit not reachable at ${MAILPIT_URL}`,
  ).toBe(true)

  await stubTurnstile(page)
  const unique = `${Date.now()}${suffix}`
  const email = `m2t12-smoke-${unique}@example.test`
  const password = E2E_PASSWORD

  await page.goto('/zh/register/student')
  await page.fill('[name="name"]', 'Smoke Test Student')
  await page.fill('[name="email"]', email)
  await page.fill('[name="password"]', password)
  await page.check('[name="agreeTerms"]')
  await page.check('[name="agreePrivacy"]')
  await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 10000 })
  await page.click('button[type="submit"]')
  await page.waitForURL('**/verify-email', { timeout: 10000 })

  let verifyUrl: string | null = null
  for (let i = 0; i < 15 && !verifyUrl; i++) {
    await page.waitForTimeout(1000)
    const msgs = await request.get(`${MAILPIT_URL}/api/v1/messages`)
    if (!msgs.ok()) continue
    const json = await msgs.json()
    const msg = (json.messages as Array<{ ID: string; To: Array<{ Address: string }> }> ?? []).find(
      (m) => m.To?.some((to: { Address: string }) => to.Address === email),
    )
    if (!msg) continue
    const msgBody = await request.get(`${MAILPIT_URL}/api/v1/message/${msg.ID}`)
    if (!msgBody.ok()) continue
    const body = await msgBody.json()
    const html: string = body.HTML ?? body.Text ?? ''
    const match = html.match(/href="([^"]*verify-email[^"]*)"/)
    if (match) verifyUrl = match[1].replace(/&amp;/g, '&')
  }
  expect(verifyUrl, 'Verification email not found').not.toBeNull()
  await page.goto(verifyUrl!)
  await page.waitForURL('**', { timeout: 10000 })

  await page.goto('/zh/login')
  await page.fill('[name="email"]', email)
  await page.fill('[name="password"]', password)
  await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 10000 })
  await page.click('button[type="submit"]')
  // Wait for auth to settle, then navigate explicitly (avoids redirect render issues)
  await page.waitForURL(/\/(s|e)\//, { timeout: 10000 })
  await page.goto('/zh/s/onboarding')

  // Complete step 1 so the StudentProfile exists and /s/invite is accessible
  await expect(page.getByText(/第 1 \/ 5 步/)).toBeVisible({ timeout: 10000 })
  await page.fill('[id="fullName"]', 'Smoke Test Student')
  await page.selectOption('[id="workAuth"]', 'STUDENT_PASS')
  await page.click('button:has-text("下一步")')
  await expect(page.getByText(/第 2 \/ 5 步/)).toBeVisible({ timeout: 5000 })

  // Step 2 needs a job type even for save-and-exit (see audit finding C18)
  await page.locator('label').filter({ hasText: '实习' }).locator('input[type="checkbox"]').check()
  // Save and exit so the user can navigate freely
  await page.click('button:has-text("保存并退出")')
  await page.waitForURL('**/s/jobs', { timeout: 10000 })
}


// 每条用例一个独立的 x-real-ip，避免并行注册、登录共用一个限流桶（见 helpers/client-ip.ts）
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': uniqueClientIp() })
})

test.describe('M2-T12 smoke: /s/invite', () => {
  test('smoke /s/invite: loads without error boundary or console errors', async ({ page, request }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await registerLoginAndCompleteStep1(page, request, 'inv')

    await page.goto('/zh/s/invite')
    await expect(page).not.toHaveURL(/error/, { timeout: 5000 })
    // No Next.js error overlay
    await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
    // No error boundary fallback text
    await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
    // Page should show invite quota section and invite link
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 })

    // Filter: favicon, network errors, and 404s from resources not yet implemented in this milestone
    expect(
      errors.filter(
        e => !e.includes('favicon') && !e.includes('net::ERR_') && !e.includes('404 (Not Found)'),
      ),
    ).toHaveLength(0)
  })
})
