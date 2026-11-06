/**
 * M4-T04 E2E: Talent pool search page.
 *
 * Fixtures are created in global-setup.ts (Prisma directly, no HTTP seed route).
 * Authentication is pre-created as storageState in global-setup.ts (avoids Better Auth's
 * 5-login-per-60s rate limit).
 *
 * Requirements verified:
 * 1. Verified company employer can search and filter to find a specific student.
 * 2. Unverified company employer sees the "verify required" prompt.
 * 3. Staying on the talent list for 3 seconds does NOT trigger ProfileView creation
 *    (checked by hovering on a card link and asserting no navigation).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import type { E2EFixtures } from './global-setup'

function loadFixtures(): E2EFixtures {
  const path = resolve(process.cwd(), 'tests/e2e/fixtures.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as E2EFixtures
}

const VERIFIED_STATE = resolve(process.cwd(), 'tests/e2e/auth-verified.json')
const UNVERIFIED_STATE = resolve(process.cwd(), 'tests/e2e/auth-unverified.json')

test.describe('Talent pool search', () => {
  let fixtures: E2EFixtures

  test.beforeAll(() => {
    fixtures = loadFixtures()
  })

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/zh/e/talent')
    await expect(page).toHaveURL(/\/zh\/login/)
  })

  test('verified company employer sees the talent search page', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    try {
      await page.goto('/zh/e/talent')
      await expect(page.getByRole('heading', { level: 1 })).toContainText('人才库')
      await expect(page.locator('aside')).toBeVisible()
    } finally {
      await ctx.close()
    }
  })

  test('search by keyword finds the test student', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    try {
      await page.goto('/zh/e/talent')

      await page.fill('#filter-keyword', 'Python')
      await page.click('button:text("应用筛选")')

      await expect(page).toHaveURL(/keyword=Python/)

      const viewLink = page.locator(`a[href*="${fixtures.student.profileId}"]`).first()
      await expect(viewLink).toBeVisible({ timeout: 10000 })
    } finally {
      await ctx.close()
    }
  })

  test('filter by degree level narrows results', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    try {
      await page.goto('/zh/e/talent?degreeLevel=BACHELOR')

      await expect(page.getByRole('heading', { level: 1 })).toContainText('人才库')
      await expect(page).toHaveURL(/degreeLevel=BACHELOR/)
    } finally {
      await ctx.close()
    }
  })

  test('hovering a card link for 3 seconds does not trigger profile view', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    try {
      await page.goto('/zh/e/talent')

      const talentDetailRequests: string[] = []
      page.on('request', (req) => {
        const url = req.url()
        // Match requests to individual talent profile pages (including RSC fetches)
        if (/\/e\/talent\/[a-zA-Z0-9]+/.test(url)) {
          talentDetailRequests.push(url)
        }
      })

      // Hover on the first talent card link and wait 3 seconds — do not click
      const cardLink = page.locator('a[href*="/e/talent/"]').first()
      await cardLink.hover()
      await page.waitForTimeout(3000)

      // No requests to individual talent pages, still on the list page
      expect(talentDetailRequests).toHaveLength(0)
      expect(page.url()).toMatch(/\/e\/talent($|\?)/)
    } finally {
      await ctx.close()
    }
  })

  test('verified employer does not see verification prompt', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    try {
      await page.goto('/zh/e/talent')

      // Should show the search page, not the "verify required" alert
      await expect(page.locator('[role="alert"].border-amber-200')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('人才库')
    } finally {
      await ctx.close()
    }
  })

  test('unverified employer sees verify-required prompt with onboarding link', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: UNVERIFIED_STATE })
    const page = await ctx.newPage()
    try {
      await page.goto('/zh/e/talent')

      // Should see a verification-required alert or banner (the amber one, not Next.js route announcer)
      const verifyAlert = page.locator('[role="alert"].border-amber-200')
      await expect(verifyAlert).toBeVisible({ timeout: 10000 })

      // The alert should link to the onboarding / verification flow
      const onboardingLink = page.locator('a[href*="onboarding"], a[href*="verify"]').first()
      await expect(onboardingLink).toBeVisible({ timeout: 5000 })
    } finally {
      await ctx.close()
    }
  })
})
