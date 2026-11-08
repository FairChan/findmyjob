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
