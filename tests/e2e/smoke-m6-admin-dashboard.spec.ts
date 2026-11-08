/**
 * E2E smoke tests for M6-T01: admin dashboard layout and data board.
 *
 * Verifies:
 * - ADMIN: /zh/admin is healthy (200, no errors, title visible)
 * - ADMIN: navigation to /zh/admin/companies and /zh/admin/jobs works (200 each)
 * - ADMIN: response has Cache-Control: no-store
 * - STUDENT: accessing /zh/admin is blocked (redirect or 403)
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M6-T01 admin dashboard smoke', () => {
  test('ADMIN: /zh/admin is healthy and shows dashboard title', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin')
    // Dashboard heading should be visible
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: /zh/admin/companies is healthy (direct nav)', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/companies')
  })

  test('ADMIN: /zh/admin/jobs is healthy (direct nav)', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/jobs')
  })

  test('ADMIN: /zh/admin response has cache-control: no-store', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/zh/admin') && !r.url().includes('/zh/admin/')),
      page.goto('/zh/admin'),
    ])
    const cacheControl = response.headers()['cache-control'] ?? ''
    expect(cacheControl.toLowerCase()).toContain('no-store')
  })

  test('STUDENT: accessing /zh/admin is blocked (redirect away)', async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    await page.goto('/zh/admin')
    await page.waitForLoadState('networkidle').catch(() => {})
    // Should be redirected away from /zh/admin (to login or other page)
    expect(page.url()).not.toMatch(/\/zh\/admin\/?$/)
  })
})
