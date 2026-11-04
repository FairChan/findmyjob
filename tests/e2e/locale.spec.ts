import { test, expect } from '@playwright/test'

test('/zh page has lang=zh-Hans', async ({ page }) => {
  await page.goto('/zh')
  const lang = await page.locator('html').getAttribute('lang')
  expect(lang).toBe('zh-Hans')
})

test('/en page has lang=en', async ({ page }) => {
  await page.goto('/en')
  const lang = await page.locator('html').getAttribute('lang')
  expect(lang).toBe('en')
})

test('language switch stays on same page', async ({ page }) => {
  await page.goto('/zh')
  // Switch to English using the locale switcher
  const enButton = page.getByRole('button', { name: 'English' })
  await enButton.click()
  await expect(page).toHaveURL('/en')
  const lang = await page.locator('html').getAttribute('lang')
  expect(lang).toBe('en')
})

test('/ redirects to /zh', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL('/zh')
})
