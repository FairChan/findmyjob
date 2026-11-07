/**
 * Nav-links smoke test (M3-T05 补修):
 * - Visits header + footer links and the mobile menu on /zh and /en; asserts none return 404.
 *   (The footer has no links today; they are covered automatically once added.)
 * - Smoke checks for /companies, /companies?tag=ALUMNI, and /register.
 */
import { test, expect } from '@playwright/test'
import { expectPageHealthy } from './helpers/smoke'

test.describe('nav links — no 404s', () => {
  test('desktop nav links on /zh all return non-404', async ({ page }) => {
    await page.goto('/zh')
    await expect(page).toHaveURL(/\/zh/)

    const links = await page.locator('header a[href], footer a[href]').evaluateAll((els) =>
      els
        .map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? '')
        .filter((h) => h.startsWith('/')),
    )
    expect(links.length).toBeGreaterThan(0)

    for (const href of links) {
      const res = await page.request.get(href)
      expect(res.status(), `${href} should not be 404`).not.toBe(404)
    }
  })

  test('desktop nav links on /en all return non-404', async ({ page }) => {
    await page.goto('/en')
    await expect(page).toHaveURL(/\/en/)

    const links = await page.locator('header a[href], footer a[href]').evaluateAll((els) =>
      els
        .map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? '')
        .filter((h) => h.startsWith('/')),
    )
    expect(links.length).toBeGreaterThan(0)

    for (const href of links) {
      const res = await page.request.get(href)
      expect(res.status(), `${href} should not be 404`).not.toBe(404)
    }
  })

  test('mobile menu links on /zh all return non-404', async ({ browser }) => {
    // Mobile viewport so the Sheet menu is accessible
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    const page = await ctx.newPage()
    await page.goto('/zh')

    // Open the mobile menu
    const openBtn = page.locator('header button[aria-label]').first()
    await openBtn.click()
    // Wait for the Sheet to open
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })

    const links = await page.locator('[role="dialog"] a[href]').evaluateAll((els) =>
      els
        .map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? '')
        .filter((h) => h.startsWith('/')),
    )

    for (const href of links) {
      const res = await page.request.get(href)
      expect(res.status(), `mobile: ${href} should not be 404`).not.toBe(404)
    }

    await ctx.close()
  })
})

test.describe('companies page smoke', () => {
  test('/zh/companies is healthy', async ({ page }) => {
    await expectPageHealthy(page, '/zh/companies')
  })

  test('/zh/companies?tag=ALUMNI is healthy', async ({ page }) => {
    await expectPageHealthy(page, '/zh/companies?tag=ALUMNI')
  })
})

test.describe('register landing smoke', () => {
  test('/zh/register is healthy', async ({ page }) => {
    await expectPageHealthy(page, '/zh/register')
  })

  test('/en/register is healthy', async ({ page }) => {
    await expectPageHealthy(page, '/en/register')
  })
})
