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

// next-intl 按 cookie → Accept-Language → 默认 zh 的顺序选语言（DECISIONS 2026-11-05）；
// 测试固定浏览器语言，否则结果取决于跑测试那台机器的系统语言
test.describe('/ with an unsupported browser language', () => {
  test.use({ locale: 'ms-MY' })
  test('falls back to /zh', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/zh')
  })
})

test.describe('/ with an English browser', () => {
  test.use({ locale: 'en-US' })
  test('redirects to /en', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/en')
  })
})
