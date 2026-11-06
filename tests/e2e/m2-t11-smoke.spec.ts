/**
 * M2-T11 smoke tests: verify modified page routes load without errors.
 *
 * Tests: /s/profile and /s/contact (the other modified route, /s/onboarding, is covered in onboarding.spec.ts).
 * Each test: logs in as a student, opens the page, asserts:
 *   - no Next.js error overlay
 *   - no console errors
 *
 * Requires: dev server + Mailpit (docker compose up -d)
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { stubTurnstile } from './helpers/turnstile'

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
  const email = `m2t11-smoke-${unique}@example.test`
  const password = 'Password123!'

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
  await page.waitForURL('**/s/onboarding', { timeout: 10000 })

  // Complete step 1 so profile exists and /s/profile is accessible
  await page.fill('[id="fullName"]', 'Smoke Test Student')
  await page.selectOption('[id="workAuth"]', 'STUDENT_PASS')
  await page.click('button:has-text("下一步")')
  await expect(page.getByText(/第 2 \/ 4 步/)).toBeVisible({ timeout: 5000 })

  // Save and exit so the user can navigate freely
  await page.click('button:has-text("保存并退出")')
  await page.waitForURL('**/s', { timeout: 10000 })
}

test.describe('M2-T11 smoke: modified student pages', () => {
  test('smoke /s/profile: loads without error boundary or console errors', async ({ page, request }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await registerLoginAndCompleteStep1(page, request, 'p')

    await page.goto('/zh/s/profile')
    await expect(page).not.toHaveURL(/error/, { timeout: 5000 })
    // No Next.js error overlay
    await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
    // No error boundary fallback text
    await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
    // Page has meaningful content (profile editor sections)
    await expect(page.locator('h2').first()).toBeVisible({ timeout: 5000 })

    expect(errors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_'))).toHaveLength(0)
  })

  test('smoke /s/contact: loads without error boundary or console errors', async ({ page, request }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await registerLoginAndCompleteStep1(page, request, 'c')

    await page.goto('/zh/s/contact')
    await expect(page).not.toHaveURL(/error/, { timeout: 5000 })
    // No Next.js error overlay
    await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
    // No error boundary fallback text
    await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
    // Page has the contact form privacy notice (updated text per M2-T11 fix 7)
    await expect(page.locator('text=/投递|解锁/').first()).toBeVisible({ timeout: 5000 })

    expect(errors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_'))).toHaveLength(0)
  })
})
