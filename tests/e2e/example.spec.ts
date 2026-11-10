import { test, expect } from '@playwright/test'

test('homepage renders the brand headline', async ({ page }) => {
  await page.goto('/')
  // `/` follows the browser language, so accept either locale's brand line.
  await expect(page.locator('h1')).toContainText(/Malaysia|马来西亚/)
})
