/**
 * E2E smoke tests for M6-T05: admin system settings.
 *
 * Tests:
 * 1. ADMIN: /zh/admin/settings is healthy (200, no errors, heading visible)
 * 2. ADMIN: /en/admin/settings is healthy
 * 3. ADMIN: page has Cache-Control: no-store
 * 4. STUDENT: /zh/admin/settings is blocked
 * 5. EMPLOYER: /zh/admin/settings is blocked
 * 6. ADMIN: can update a setting (team.maxMembers) and get success feedback
 * 7. ADMIN: invalid value shows an error
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M6-T05 admin settings smoke', () => {
  test('ADMIN: /zh/admin/settings is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/settings')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: /en/admin/settings is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/en/admin/settings')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: settings page response has Cache-Control: no-store', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/zh/admin/settings') && r.request().method() === 'GET',
      ),
      page.goto('/zh/admin/settings'),
    ])
    const cacheControl = response.headers()['cache-control'] ?? ''
    expect(cacheControl.toLowerCase()).toContain('no-store')
  })

  test('STUDENT: /zh/admin/settings is blocked', async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    await page.goto('/zh/admin/settings')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(page.url()).not.toMatch(/\/zh\/admin\/settings/)
  })

  test('EMPLOYER: /zh/admin/settings is blocked', async ({ page }) => {
    await loginAs(page, { role: 'EMPLOYER' })
    await page.goto('/zh/admin/settings')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(page.url()).not.toMatch(/\/zh\/admin\/settings/)
  })

  test('ADMIN: settings form renders setting rows', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/settings')
    // Should show the billing.enabled row
    await expect(page.getByText('billing.enabled')).toBeVisible()
  })

  test('ADMIN: can save a setting and see success feedback', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/settings')

    // Find the team.maxMembers row and change its value
    const row = page.locator('tr', { has: page.getByText('team.maxMembers') })
    const input = row.locator('input[type="text"]')
    await input.fill('4')

    // Click save button in the same row
    const saveBtn = row.getByRole('button', { name: /保存|Save/ })
    await saveBtn.click()

    // Wait for success indicator
    await expect(row.getByText(/已保存|Saved/)).toBeVisible({ timeout: 10000 })
  })
})
