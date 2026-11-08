/**
 * Smoke tests for M5-T08: Notification pages.
 *
 * Tests:
 * 1. Student /s/notifications page loads without errors.
 * 2. Employer /e/notifications page loads without errors.
 * 3. Admin /admin/notifications page loads without errors.
 * 4. Student notifications page shows pre-seeded notification item.
 */
import { test, expect } from '@playwright/test'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M5-T08 notifications smoke', () => {
  test('bell shows 2 unread → click 全部标为已读 → bell clears', async ({ page }) => {
    const { userId } = await loginAs(page, { role: 'STUDENT' })

    // Pre-seed 2 unread notifications
    const notifications = await e2eDb.notification.createMany({
      data: [
        { userId, type: 'invitation.received', payload: {} },
        { userId, type: 'credits.low', payload: { balance: 2 } },
      ],
    })

    try {
      // Navigate to the notifications page — server renders with unreadCount=2
      await page.goto('/zh/s/notifications')
      await page.waitForLoadState('networkidle')

      // The bell badge in StudentNav should show "2"
      const bellBadge = page.locator('nav a[href*="/s/notifications"] span[aria-hidden="true"]').first()
      await expect(bellBadge).toHaveText('2', { timeout: 8000 })

      // Click the "全部标为已读" button
      await page.getByRole('button', { name: /全部标为已读/ }).click()

      // Wait for window.location.reload() to settle
      await page.waitForLoadState('networkidle')

      // After reload, the badge should be gone (all notifications now read)
      const badgeAfter = page.locator('nav a[href*="/s/notifications"] span[aria-hidden="true"]')
      await expect(badgeAfter).not.toBeVisible({ timeout: 8000 })
    } finally {
      // Clean up notifications
      await e2eDb.notification
        .deleteMany({ where: { userId } })
        .catch(() => {})
    }
  })


  test('student /s/notifications page is healthy', async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    await expectPageHealthy(page, '/zh/s/notifications')
  })

  test('employer /e/notifications page is healthy', async ({ page }) => {
    await loginAs(page, { role: 'EMPLOYER', company: { verificationStatus: 'VERIFIED' } })
    await expectPageHealthy(page, '/zh/e/notifications')
  })

  test('admin /admin/notifications page is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/notifications')
  })

  test('student notifications page shows pre-seeded notification', async ({ page }) => {
    const { userId } = await loginAs(page, { role: 'STUDENT' })

    // Pre-seed a notification for this student
    const notif = await e2eDb.notification.create({
      data: { userId, type: 'talent.unlock', payload: {} },
    })

    try {
      await page.goto('/zh/s/notifications')
      await page.waitForLoadState('networkidle')

      // The page should render the notification label
      await expect(page.getByText(/企业解锁了你的联系方式|A company unlocked/i)).toBeVisible({ timeout: 8000 })
    } finally {
      await e2eDb.notification.deleteMany({ where: { id: notif.id } }).catch(() => {})
    }
  })
})
