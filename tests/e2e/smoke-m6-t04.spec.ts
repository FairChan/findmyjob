/**
 * E2E smoke tests for M6-T04: admin schools & partners management.
 *
 * Tests:
 * 1. ADMIN: /zh/admin/schools is healthy (200, no errors, heading visible)
 * 2. ADMIN: /zh/admin/schools/new is healthy
 * 3. ADMIN: /zh/admin/partners is healthy
 * 4. ADMIN: /zh/admin/partners/new is healthy
 * 5. ADMIN: /zh/admin/schools has Cache-Control: no-store
 * 6. STUDENT: accessing /zh/admin/schools is blocked
 * 7. EMPLOYER: accessing /zh/admin/partners is blocked
 * 8. Home page (/) shows partner section when partners exist (or at least is healthy)
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb as db } from './helpers/db'

test.describe('M6-T04 admin schools & partners smoke', () => {
  test('ADMIN: /zh/admin/schools is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/schools')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: /zh/admin/schools/new is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/schools/new')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: /zh/admin/partners is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/partners')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: /zh/admin/partners/new is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/partners/new')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: emptying optional fields on the edit form clears them in the DB (M6-T11)', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })

    const partner = await db.partner.create({
      data: {
        name: `E2E Clear Partner ${Date.now()}`,
        nameEn: 'Clear Partner EN',
        type: 'ENTERPRISE',
        website: 'https://example.com/partner',
        description: 'to be cleared',
        notes: 'internal note to be cleared',
        showOnHome: false,
        sortOrder: 98,
      },
    })
    try {
      await page.goto(`/zh/admin/partners/${partner.id}`)
      await expect(page.locator('#website')).toHaveValue('https://example.com/partner')

      for (const id of ['nameEn', 'website', 'description', 'notes']) {
        await page.locator(`#${id}`).fill('')
      }
      await page.locator('form button[type="submit"]').click()
      await expect(page).toHaveURL(/\/zh\/admin\/partners$/, { timeout: 15000 })

      await expect
        .poll(async () => {
          const row = await db.partner.findUnique({
            where: { id: partner.id },
            select: { nameEn: true, website: true, description: true, notes: true, name: true },
          })
          return JSON.stringify(row && { ...row, name: row.name === partner.name })
        })
        .toBe(JSON.stringify({ nameEn: null, website: null, description: null, notes: null, name: true }))
    } finally {
      await db.partner.delete({ where: { id: partner.id } }).catch(() => {})
    }
  })

  test('ADMIN: partner edit page is healthy after creating a partner', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })

    const partner = await db.partner.create({
      data: {
        name: `E2E Partner ${Date.now()}`,
        type: 'ENTERPRISE',
        showOnHome: false,
        sortOrder: 99,
      },
    })

    await expectPageHealthy(page, `/zh/admin/partners/${partner.id}`)

    // Cleanup
    await db.partner.delete({ where: { id: partner.id } }).catch(() => {})
  })

  test('ADMIN: /zh/admin/schools response has Cache-Control: no-store', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/zh/admin/schools') && !r.url().includes('/zh/admin/schools/'),
      ),
      page.goto('/zh/admin/schools'),
    ])
    const cacheControl = response.headers()['cache-control'] ?? ''
    expect(cacheControl.toLowerCase()).toContain('no-store')
  })

  test('STUDENT: /zh/admin/schools is blocked', async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    await page.goto('/zh/admin/schools')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(page.url()).not.toMatch(/\/zh\/admin\/schools/)
  })

  test('EMPLOYER: /zh/admin/partners is blocked', async ({ page }) => {
    await loginAs(page, { role: 'EMPLOYER' })
    await page.goto('/zh/admin/partners')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(page.url()).not.toMatch(/\/zh\/admin\/partners/)
  })

  test('Home page /zh is healthy', async ({ page }) => {
    await expectPageHealthy(page, '/zh')
  })
})
