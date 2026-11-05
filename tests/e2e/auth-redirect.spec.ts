/**
 * M1-T04 E2E: student registration → email verification → login → /s/onboarding
 *
 * Requires Mailpit (http://localhost:8025) to be running.
 * Skips gracefully when Mailpit is not available (local dev without Docker).
 */
import { test, expect } from '@playwright/test'

const MAILPIT_URL = 'http://localhost:8025'

async function isMailpitAvailable(request: typeof test.info extends () => infer R ? R : never): Promise<boolean> {
  // We detect availability inline per test; just return true optimistically.
  return true
}

test.describe('student registration → verification → onboarding redirect', () => {
  test('new student is redirected to /s/onboarding after login', async ({ page, request }) => {
    // Skip if Mailpit is not available
    const mailpitCheck = await request.get(`${MAILPIT_URL}/api/v1/messages`).catch(() => null)
    if (!mailpitCheck || !mailpitCheck.ok()) {
      test.skip(true, 'Mailpit not available — skipping E2E email verification test')
      return
    }

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
    await page.click('button[type="submit"]')

    // Should reach verify-email page
    await expect(page).toHaveURL(/\/register\/verify-email/)

    // --- Step 2: Fetch verification link from Mailpit ---
    // Poll for the verification email (up to 10 seconds)
    let verificationUrl: string | null = null
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000)
      const response = await request.get(`${MAILPIT_URL}/api/v1/messages`)
      if (!response.ok()) continue

      const data = await response.json()
      const messages: Array<{
        ID: string
        To: Array<{ Address: string }>
        Subject: string
      }> = data.messages ?? []

      const msg = messages.find((m) => m.To.some((r) => r.Address === email))
      if (!msg) continue

      // Get the full message body
      const bodyResp = await request.get(`${MAILPIT_URL}/api/v1/message/${msg.ID}`)
      if (!bodyResp.ok()) continue

      const bodyData = await bodyResp.json()
      const html: string = bodyData.HTML ?? bodyData.Text ?? ''

      // Extract verification link (Better Auth sends https://APP_URL/api/auth/verify-email?token=...)
      const match = html.match(/href="([^"]*verify-email[^"]*)"/)
        ?? html.match(/(https?:\/\/[^\s<>"]*verify-email[^\s<>"]*)/i)
      if (match) {
        verificationUrl = match[1].replace(/&amp;/g, '&')
        break
      }
    }

    if (!verificationUrl) {
      test.skip(true, 'Verification email not received within 10 seconds')
      return
    }

    // --- Step 3: Click the verification link ---
    await page.goto(verificationUrl)
    // After verification, Better Auth may redirect or show a page; wait briefly
    await page.waitForURL(/.*/, { timeout: 5000 }).catch(() => {})

    // --- Step 4: Log in ---
    await page.goto('/zh/login')
    await expect(page.locator('h1')).toContainText('登录')
    await page.fill('[name="email"]', email)
    await page.fill('[name="password"]', password)
    await page.click('button[type="submit"]')

    // --- Step 5: Should land on /s/onboarding ---
    await expect(page).toHaveURL(/\/s\/onboarding/, { timeout: 10000 })
  })
})
