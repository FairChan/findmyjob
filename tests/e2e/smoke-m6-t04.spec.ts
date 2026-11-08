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
