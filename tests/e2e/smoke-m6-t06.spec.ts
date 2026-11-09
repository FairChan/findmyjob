/**
 * E2E smoke tests for M6-T06: admin audit log page.
 *
 * Tests:
 * 1. ADMIN: /zh/admin/audit is healthy (200, no errors, heading visible)
 * 2. ADMIN: /en/admin/audit is healthy
 * 3. ADMIN: page has Cache-Control: no-store
 * 4. STUDENT: /zh/admin/audit is blocked (redirected away)
 * 5. EMPLOYER: /zh/admin/audit is blocked (redirected away)
 * 6. ADMIN: action filter dropdown contains known AUDIT_ACTIONS
 * 7. a11y: 375px viewport — no serious/critical violations
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb as db } from './helpers/db'
import { checkA11y } from './helpers/a11y'

test.describe('M6-T06 admin audit log smoke', () => {
  test('ADMIN: /zh/admin/audit is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/audit')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: /en/admin/audit is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/en/admin/audit')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: audit page response has Cache-Control: no-store', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/zh/admin/audit') && r.request().method() === 'GET',
      ),
      page.goto('/zh/admin/audit'),
    ])
    const cacheControl = response.headers()['cache-control'] ?? ''
    expect(cacheControl.toLowerCase()).toContain('no-store')
  })

  test('STUDENT: /zh/admin/audit is blocked', async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    await page.goto('/zh/admin/audit')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(page.url()).not.toMatch(/\/zh\/admin\/audit/)
  })

  test('EMPLOYER: /zh/admin/audit is blocked', async ({ page }) => {
    await loginAs(page, { role: 'EMPLOYER' })
    await page.goto('/zh/admin/audit')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(page.url()).not.toMatch(/\/zh\/admin\/audit/)
  })

  test('ADMIN: action filter dropdown has at least some known actions', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/audit')
    // The action select should have options for known actions
    const select = page.locator('select[name="action"]')
    await expect(select).toBeVisible()
    const options = await select.locator('option').allTextContents()
    expect(options).toContain('auth.login')
    expect(options).toContain('setting.update')
    expect(options).toContain('contact.read')
  })

  test('ADMIN: action filter shows results (insert a row, filter by it)', async ({ page }) => {
    // Insert an audit log row for auth.login via the test DB
    const admin = await db.user.create({
      data: {
        name: 'Audit E2E Admin',
        email: `audit-e2e-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    })
    await db.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'auth.login',
        targetType: 'User',
        targetId: admin.id,
        metadata: {},
      },
    })

    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/audit?action=auth.login')
    // Should see at least one row with auth.login
    await expect(page.getByRole('cell', { name: 'auth.login', exact: true }).first()).toBeVisible()
  })

  test('ADMIN: 375px mobile a11y check on /zh/admin/audit', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/audit')
    await checkA11y(page)
  })
})
