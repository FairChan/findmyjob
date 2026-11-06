/**
 * Smoke tests for M2-T11 and M2-T12 student pages (M2-T13 items 4 and 7).
 *
 * Tests:
 *  - /s/onboarding: 200, no console errors, no error boundary (item 7)
 *  - /s/profile: 200 (item 7)
 *  - /s/contact: 200 (item 7)
 *  - /s/invite: 200, has progressbar, invite link input has correct ref= param (items 4 and 7)
 */
import { test, expect } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'


test.describe('M2 student pages smoke (M2-T13)', () => {
  test('STUDENT: /zh/s/onboarding is healthy (200, no console errors, no error page)', async ({
    page,
  }) => {
    const { userId } = await loginAs(page, { role: 'STUDENT' })
    // Onboarding page redirects to /s if no StudentProfile exists — create one
    await db.studentProfile.create({
      data: { userId, fullName: '测试向导同学', onboardingStep: 1 },
    })
    await expectPageHealthy(page, '/zh/s/onboarding')
  })

  test('STUDENT: /zh/s/profile is healthy (200)', async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    const res = await page.goto('/zh/s/profile')
    expect(res?.status()).toBe(200)
  })

  test('STUDENT: /zh/s/contact is healthy (200)', async ({ page }) => {
    const { userId } = await loginAs(page, { role: 'STUDENT' })
    // Contact page throws NotFoundError if no StudentProfile exists — create one
    await db.studentProfile.create({
      data: { userId, fullName: '测试联系同学' },
    })
    const res = await page.goto('/zh/s/contact')
    expect(res?.status()).toBe(200)
  })

  test('STUDENT: /zh/s/invite is healthy (200), has progressbar, invite link has ?ref= param (item 4)', async ({
    page,
  }) => {
    const { userId } = await loginAs(page, { role: 'STUDENT' })

    // Create a minimal StudentProfile so /s/invite doesn't redirect to /s/onboarding
    await db.studentProfile.create({
      data: {
        userId,
        fullName: '测试邀请同学',
      },
    })

    const res = await page.goto('/zh/s/invite')
    expect(res?.status()).toBe(200)

    // Should stay on invite page (not redirected to onboarding)
    await expect(page).toHaveURL(/\/s\/invite/, { timeout: 5000 })

    // Progressbar should be visible (quota display for non-unlimited students)
    await expect(page.locator('[role="progressbar"]')).toBeVisible({ timeout: 5000 })

    // The CopyLinkButton renders a readonly input with the invite link
    // Invite link contains ?ref=<8-char-code>
    const copyInput = page.locator('input[readonly]').first()
    await expect(copyInput).toHaveValue(/\?ref=[\w-]{8}$/, { timeout: 5000 })
  })
})
