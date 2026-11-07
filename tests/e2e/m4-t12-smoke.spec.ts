/**
 * M4-T12 smoke tests: student notifications and privacy centre (who-viewed / who-unlocked).
 *
 * Pages covered:
 *   /s/notifications  — student notification list (new in M4-T12)
 *   /s/privacy        — privacy centre with real ProfileView and TalentUnlock data
 *
 * Flow tested:
 *   The verified employer fixture has already unlocked the M4-T12 student (set up in
 *   global-setup.ts). A talent.unlock notification for that student is also pre-created.
 *   Tests verify:
 *     1. /s/notifications loads (200, no error boundary, no console errors)
 *     2. The unlock notification text is visible in the notifications list
 *     3. /s/privacy loads (200, no error boundary, no console errors)
 *     4. The unlocked company is listed in the "谁解锁了我" section
 *
 * Authentication is pre-created as storageState in auth.setup.ts (m4t12 student).
 */
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'

const STUDENT_STATE = resolve(process.cwd(), 'tests/e2e/auth-m4t12-student.json')

function assertNoErrors(errors: string[]) {
  const relevant = errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('net::ERR_') &&
      !e.includes('Failed to load resource'),
  )
  expect(relevant, `Unexpected console errors: ${relevant.join('; ')}`).toHaveLength(0)
}

test.describe('M4-T12: student notifications and privacy centre', () => {

  test('smoke /s/notifications: 200, no error boundary, no console errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: STUDENT_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto('/zh/s/notifications')
      expect(response?.status()).toBe(200)
      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('notifications page shows talent.unlock notification', async ({ browser }) => {
    // The global-setup has pre-created a talent.unlock notification for the M4-T12 student.
    // Verify the student can see it on the notifications page.
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: STUDENT_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      await page.goto('/zh/s/notifications')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

      // The unlock notification text should be visible
      await expect(page.getByText('企业解锁了你的联系方式')).toBeVisible({ timeout: 5000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('notifications page has link to privacy centre', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: STUDENT_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      await page.goto('/zh/s/notifications')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

      // Link to privacy centre should be visible for the unlock notification
      const privacyLink = page.getByRole('link', { name: '前往隐私中心查看详情' })
      await expect(privacyLink).toBeVisible({ timeout: 5000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('smoke /s/privacy: 200, no error boundary, no console errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: STUDENT_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto('/zh/s/privacy')
      expect(response?.status()).toBe(200)
      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('privacy centre shows unlock in "谁解锁了我" section', async ({ browser }) => {
    // The global-setup created a TalentUnlock record for this student by the verified employer.
    // Verify the student can see it in the privacy centre.
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: STUDENT_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      await page.goto('/zh/s/privacy')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

      // The "谁解锁了我" section heading should be visible
      await expect(page.getByRole('heading', { name: '谁解锁了我' })).toBeVisible({ timeout: 5000 })

      // The verified employer company should be listed in the unlocks section
      // (global-setup creates company "E2E Verified Co Sdn Bhd")
      await expect(page.getByText('E2E Verified Co Sdn Bhd')).toBeVisible({ timeout: 5000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })
})
