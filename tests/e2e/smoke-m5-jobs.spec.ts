/**
 * Smoke tests for M5-T01 (employer job management).
 * Tests /e/jobs (list), /e/jobs/new (new job form), and /e/jobs/[id]/edit for a verified employer.
 */
import { test } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb } from './helpers/db'

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

  test('/zh/e/jobs/[id]/edit is healthy for VERIFIED employer', async ({ page }) => {
    const { userId, companyId } = await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })
    // Create a job in the test DB for this employer's company.
    const job = await e2eDb.job.create({
      data: {
        companyId: companyId!,
        createdById: userId,
        title: 'E2E Smoke Edit Job',
        type: 'INTERNSHIP',
        description: 'Smoke test job for edit page.',
        status: 'DRAFT',
        workMode: 'ONSITE',
      },
    })
    await expectPageHealthy(page, `/zh/e/jobs/${job.id}/edit`)
  })
})
