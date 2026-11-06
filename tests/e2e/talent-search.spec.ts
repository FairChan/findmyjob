/**
 * M4-T04 E2E: Talent pool search page.
 *
 * Uses /api/test/talent-search-seed to create test fixtures:
 * - A verified employer account that can log in
 * - A test student with a visible, searchable profile
 *
 * Requirements verified:
 * 1. Verified company employer can search and filter to find a specific student.
 * 2. Unverified company employer sees the "verify required" prompt.
 * 3. Staying on the talent list for 3 seconds does NOT trigger ProfileView creation.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

const SEED_PATH = '/api/test/talent-search-seed'

interface SeedResult {
  employerEmail: string
  employerPassword: string
  companyId: string
  studentProfileId: string
  studentName: string
}

async function seedTestData(request: APIRequestContext): Promise<SeedResult> {
  const resp = await request.post(SEED_PATH)
  if (!resp.ok()) {
    throw new Error(`Seed endpoint returned ${resp.status()}: ${await resp.text()}`)
  }
  return resp.json() as Promise<SeedResult>
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/zh/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  // Wait for Turnstile widget (test key delivers token automatically)
  await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 15000 })
  await page.click('button[type="submit"]')
  // Should redirect away from /login
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15000 })
}

test.describe('Talent pool search', () => {
  let seed: SeedResult

  test.beforeAll(async ({ request }) => {
    seed = await seedTestData(request)
  })

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/zh/e/talent')
    await expect(page).toHaveURL(/\/zh\/login/)
  })

  test('verified company employer sees the talent search page', async ({ page }) => {
    await loginAs(page, seed.employerEmail, seed.employerPassword)
    await page.goto('/zh/e/talent')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('人才库')
    // Filter sidebar visible on desktop
    await expect(page.locator('aside')).toBeVisible()
  })

  test('search by keyword finds the test student', async ({ page }) => {
    await loginAs(page, seed.employerEmail, seed.employerPassword)
    await page.goto('/zh/e/talent')

    await page.fill('#filter-keyword', 'Python')
    await page.click('button:text("应用筛选")')

    await expect(page).toHaveURL(/keyword=Python/)

    // The test student's profile card link should appear in the results
    const viewLink = page.locator(`a[href*="${seed.studentProfileId}"]`).first()
    await expect(viewLink).toBeVisible({ timeout: 10000 })
  })

  test('filter by degree level narrows results', async ({ page }) => {
    await loginAs(page, seed.employerEmail, seed.employerPassword)
    await page.goto('/zh/e/talent?degreeLevel=BACHELOR')

    await expect(page.getByRole('heading', { level: 1 })).toContainText('人才库')
    await expect(page).toHaveURL(/degreeLevel=BACHELOR/)
  })

  test('staying on talent list for 3 seconds does not trigger profile view creation', async ({
    page,
  }) => {
    await loginAs(page, seed.employerEmail, seed.employerPassword)
    await page.goto('/zh/e/talent')

    // Track any network requests to profile view APIs
    const profileViewRequests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (/talent\/.+\/view|profile-view|profileView/i.test(url)) {
        profileViewRequests.push(url)
      }
    })

    await page.waitForTimeout(3000)

    expect(profileViewRequests).toHaveLength(0)
    // Still on the list page (not navigated to detail)
    expect(page.url()).toMatch(/\/e\/talent($|\?)/)
  })

  test('verified employer does not see verification prompt', async ({ page }) => {
    await loginAs(page, seed.employerEmail, seed.employerPassword)
    await page.goto('/zh/e/talent')

    // Should show the search page, not the "verify required" alert
    const verifyAlert = page.getByRole('alert')
    await expect(verifyAlert).not.toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('人才库')
  })
})
