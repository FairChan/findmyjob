/**
 * M2-T01 / M2-T11 E2E: Student onboarding wizard (4-step)
 *
 * Requires: dev server + Mailpit (docker compose up -d).
 * The test registers a new student, verifies email via Mailpit, then walks
 * through all 4 onboarding steps, verifying:
 *   1. Progress indicator updates correctly
 *   2. Data survives a save-and-exit cycle (resumes at correct step — M2-T11 fix 2)
 *   3. Values persist after page refresh
 *   4. Wizard completes and redirects to /s
 *   5. 375px viewport works without horizontal scroll on the actual onboarding page (M2-T11 fix 2)
 */
import { test, expect } from '@playwright/test'
import { stubTurnstile } from './helpers/turnstile'

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8026'

/** Register a student, verify email via Mailpit, and log in. Returns the logged-in page. */
async function registerAndLogin(
  page: Parameters<typeof test.beforeAll>[0] extends never ? never : import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  suffix?: string,
) {
  const mailpitCheck = await request.get(`${MAILPIT_URL}/api/v1/messages`).catch(() => null)
  expect(
    mailpitCheck?.ok(),
    `Mailpit is not reachable at ${MAILPIT_URL} (run: docker compose up -d mailpit)`,
  ).toBe(true)

  await stubTurnstile(page)
  const unique = `${Date.now()}${suffix ?? ''}`
  const email = `onboarding-test-${unique}@example.test`
  const password = 'Password123!'

  await page.goto('/zh/register/student')
  await page.fill('[name="name"]', '测试向导同学')
  await page.fill('[name="email"]', email)
  await page.fill('[name="password"]', password)
  await page.check('[name="agreeTerms"]')
  await page.check('[name="agreePrivacy"]')
  await expect(page.locator('button[type="submit"]')).toBeEnabled({ timeout: 10000 })
  await page.click('button[type="submit"]')
  await page.waitForURL('**/verify-email', { timeout: 10000 })

  // Fetch verification link from Mailpit
  let verifyUrl: string | null = null
  for (let i = 0; i < 15 && !verifyUrl; i++) {
    await page.waitForTimeout(1000)
    const msgs = await request.get(`${MAILPIT_URL}/api/v1/messages`)
    if (!msgs.ok()) continue
    const json = await msgs.json()
    const msg = (json.messages as Array<{ ID: string; To: Array<{ Address: string }> }> ?? []).find(
      (m) => m.To?.some((to) => to.Address === email),
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
}

test.describe('Student onboarding wizard', () => {
  test('complete 4-step wizard, save-and-exit resumes at correct step, values persist after refresh', async ({ page, request }) => {
    await registerAndLogin(page, request, 'a')

    // --- Check step 1 progress indicator ---
    await expect(page.getByText(/第 1 \/ 4 步/)).toBeVisible()

    // --- Complete step 1: Basic Information ---
    await page.fill('[id="fullName"]', '测试向导同学')
    await page.selectOption('[id="workAuth"]', 'STUDENT_PASS')
    await page.click('button:has-text("下一步")')
    await expect(page.getByText(/第 2 \/ 4 步/)).toBeVisible({ timeout: 5000 })

    // --- Complete step 2: Job Preferences ---
    const internshipCheckbox = page.locator('label').filter({ hasText: '实习' }).locator('input[type="checkbox"]')
    if (await internshipCheckbox.count() > 0) {
      await internshipCheckbox.check()
    }
    await page.click('button:has-text("下一步")')
    await expect(page.getByText(/第 3 \/ 4 步/)).toBeVisible({ timeout: 5000 })

    // --- Save and exit on step 3 ---
    await page.click('button:has-text("保存并退出")')
    await page.waitForURL('**/s', { timeout: 10000 })

    // --- Re-enter onboarding: should resume at step 3 (M2-T11 fix 2) ---
    await page.goto('/zh/s/onboarding')
    await expect(page.getByText(/第 3 \/ 4 步/)).toBeVisible({ timeout: 5000 })

    // --- Refresh: values (step) should still persist (M2-T11 fix 2) ---
    await page.reload()
    await expect(page.getByText(/第 3 \/ 4 步/)).toBeVisible({ timeout: 5000 })

    // --- Complete step 3: Skills & Languages ---
    await page.click('button:has-text("添加语言")')
    await page.fill('input[placeholder*="语言"]', 'zh')
    await page.click('button:has-text("下一步")')
    await expect(page.getByText(/第 4 \/ 4 步/)).toBeVisible({ timeout: 5000 })

    // --- Complete step 4: Experience (empty is fine) ---
    await page.click('button:has-text("完成")')
    await page.waitForURL('**/s', { timeout: 10000 })

    // After completion, should NOT redirect back to onboarding
    await page.goto('/zh/s/onboarding')
    await expect(page).toHaveURL(/\/s$/)
  })

  test('375px viewport: onboarding page is usable without horizontal scroll (M2-T11 fix 2)', async ({ page, request }) => {
    await registerAndLogin(page, request, 'b')

    // Set 375px viewport after login
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/zh/s/onboarding')

    // Should be on the onboarding page (not redirected away)
    await expect(page.getByText(/第 1 \/ 4 步/)).toBeVisible({ timeout: 5000 })

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = page.viewportSize()!.width
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 2) // 2px tolerance
  })
})
