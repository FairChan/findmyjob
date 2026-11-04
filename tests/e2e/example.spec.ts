import { test, expect } from '@playwright/test'

test('homepage renders the site name', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('FindMYJob')
})
