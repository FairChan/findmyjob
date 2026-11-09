/**
 * Company website links only render for http/https URLs (M6-T11 defence in depth).
 * Write-time validation already rejects other schemes, but rows created before it
 * (or by imports) must not turn into javascript: links on the public or admin pages.
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { e2eDb as db } from './helpers/db'

const UNSAFE = 'javascript:alert(1)'

test.describe('company website href only for http/https', () => {
  test('public company page: javascript: website renders no link; https website does', async ({ page }) => {
    const unsafe = await db.company.create({
      data: { legalName: `Href Unsafe ${Date.now()}`, verificationStatus: 'VERIFIED', isActive: true, website: UNSAFE },
    })
    await page.goto(`/zh/companies/${unsafe.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('a[href^="javascript:" i]')).toHaveCount(0)

    const safe = await db.company.create({
      data: {
        legalName: `Href Safe ${Date.now()}`,
        verificationStatus: 'VERIFIED',
        isActive: true,
        website: 'https://example.com/about',
      },
    })
    await page.goto(`/zh/companies/${safe.id}`)
    await expect(page.locator('a[href="https://example.com/about"]')).toBeVisible()
  })

  test('admin company detail: javascript: website is shown as text, not a link', async ({ page }) => {
    const company = await db.company.create({
      data: { legalName: `Href Admin ${Date.now()}`, verificationStatus: 'PENDING', isActive: true, website: UNSAFE },
    })
    await loginAs(page, { role: 'ADMIN' })
    await page.goto(`/zh/admin/companies/${company.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(UNSAFE)).toBeVisible()
    await expect(page.locator('a[href^="javascript:" i]')).toHaveCount(0)
  })
})
