/**
 * E2E smoke tests for the re-consent flow.
 *
 * Verifies that:
 *  1. A user without consent records is redirected to /legal/reconsent when
 *     visiting a protected page.
 *  2. After completing the consent form, the user can access the protected page.
 *  3. A user with consent records (the loginAs default) is NOT redirected.
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test('student without consent is redirected to reconsent page', async ({ page }) => {
  await loginAs(page, { role: 'STUDENT', consent: false })
  await page.goto('/zh/s')
  await expect(page).toHaveURL(/\/zh\/legal\/reconsent/, { timeout: 10000 })
})

test('student completes reconsent and can then access /zh/s', async ({ page }) => {
  await loginAs(page, { role: 'STUDENT', consent: false })
  // Should be redirected to reconsent
  await page.goto('/zh/s')
  await expect(page).toHaveURL(/\/zh\/legal\/reconsent/, { timeout: 10000 })

  // Complete the consent form
  await page.check('input[type="checkbox"]')
  await page.click('button[type="submit"]')

  // Wait for the redirect away from the reconsent page (1.5s delay in the form)
  await page.waitForURL((url) => !url.pathname.includes('/legal/reconsent'), { timeout: 10000 })

  // Now accessing /zh/s should be healthy
  await expectPageHealthy(page, '/zh/s', { expectUrl: '/zh/s' })
})

test('student with consent (loginAs default) is not redirected to reconsent', async ({ page }) => {
  await loginAs(page, { role: 'STUDENT' })
  await page.goto('/zh/s')
  // Should NOT be on the reconsent page
  await expect(page).not.toHaveURL(/\/legal\/reconsent/, { timeout: 10000 })
  await expectPageHealthy(page, '/zh/s', { expectUrl: '/zh/s' })
})
