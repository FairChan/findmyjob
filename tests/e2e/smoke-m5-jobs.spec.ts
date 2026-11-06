/**
 * Smoke tests for M5-T01 (employer job management).
 * Tests /e/jobs (list) and /e/jobs/new (new job form) for a verified employer.
 */
import { test } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M5-T01 job management smoke', () => {
  test('/zh/e/jobs is healthy for VERIFIED employer', async ({ page }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })
    await expectPageHealthy(page, '/zh/e/jobs')
  })

  test('/zh/e/jobs/new is healthy for VERIFIED employer', async ({ page }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })
    await expectPageHealthy(page, '/zh/e/jobs/new')
  })

  test('/zh/e/jobs is healthy for UNSUBMITTED employer', async ({ page }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'UNSUBMITTED', memberRole: 'OWNER', isActive: true },
    })
    await expectPageHealthy(page, '/zh/e/jobs')
  })
})
