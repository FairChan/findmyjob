/**
 * M4-T20 smoke tests: enterprise dashboard (wallet balance display).
 *
 * Pages covered:
 *   /e  — employer dashboard (shows wallet balance from credits service)
 *
 * Tests:
 *   1. Verified employer sees the dashboard (200, no error boundary, no console errors).
 */
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'

const VERIFIED_STATE = resolve(process.cwd(), 'tests/e2e/auth-verified.json')

function assertNoErrors(errors: string[]) {
  const relevant = errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('net::ERR_') &&
      !e.includes('Failed to load resource'),
  )
  expect(relevant, `Unexpected console errors: ${relevant.join('; ')}`).toHaveLength(0)
}

test.describe('M4-T20 smoke: employer dashboard', () => {
  test('smoke /e: 200, no error boundary, no console errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto('/zh/e')
      expect(response?.status()).toBe(200)
      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })
})
