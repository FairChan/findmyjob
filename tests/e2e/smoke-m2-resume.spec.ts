/**
 * Smoke test for M2-T05 student resume page.
 * Verifies the page renders without crashes for an authenticated student.
 */
import { test } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M2 student resume smoke', () => {
  test('STUDENT: /zh/s/resume is healthy', async ({ page }) => {
    // requireStudent only needs role=STUDENT + status=ACTIVE; no StudentProfile required
    // (the page defaults to an empty resume list when no profile exists)
    await loginAs(page, { role: 'STUDENT' })
    await expectPageHealthy(page, '/zh/s/resume')
  })
})
