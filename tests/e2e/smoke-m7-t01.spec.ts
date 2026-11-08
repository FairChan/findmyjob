/**
 * E2E smoke tests for M7-T01: homepage and introduction pages.
 *
 * Tests:
 * 1. /zh is healthy (200, no errors)
 * 2. /en is healthy
 * 3. /zh/for-employers is healthy
 * 4. /zh/partners is healthy
 * 5. /en/for-employers is healthy
 * 6. /zh is usable at 375px viewport width (mobile a11y)
 * 7. /zh/for-employers is usable at 375px
 * 8. /zh/partners is usable at 375px
 */
import { test, expect } from '@playwright/test'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M7-T01 smoke: public homepage and intro pages', () => {
  test('/zh homepage is healthy', async ({ page }) => {
    await expectPageHealthy(page, '/zh')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('/en homepage is healthy', async ({ page }) => {
    await expectPageHealthy(page, '/en')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('/zh/for-employers is healthy', async ({ page }) => {
    await expectPageHealthy(page, '/zh/for-employers')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('/zh/partners is healthy', async ({ page }) => {
    await expectPageHealthy(page, '/zh/partners')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('/en/for-employers is healthy', async ({ page }) => {
    await expectPageHealthy(page, '/en/for-employers')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('/zh is usable at 375px mobile viewport', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    const page = await ctx.newPage()
    await expectPageHealthy(page, '/zh')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await ctx.close()
  })

  test('/zh/for-employers is usable at 375px mobile viewport', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    const page = await ctx.newPage()
    await expectPageHealthy(page, '/zh/for-employers')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await ctx.close()
  })

  test('/zh/partners is usable at 375px mobile viewport', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    const page = await ctx.newPage()
    await expectPageHealthy(page, '/zh/partners')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await ctx.close()
  })
})
