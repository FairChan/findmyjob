/**
 * Smoke tests for M5-T02 (admin job review queue).
 * Verifies /admin/jobs and /admin/jobs/[jobId] render correctly for ADMIN.
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb as db } from './helpers/db'
import { faker } from '@faker-js/faker'

test.describe('M5-T02 admin job review smoke', () => {
  test('ADMIN: /zh/admin/jobs is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/jobs')
  })

  test('ADMIN: /zh/admin/jobs/<id> with PENDING_REVIEW job is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })

    // Create a VERIFIED company with a PENDING_REVIEW job
    const ownerEmail = `e2e-job-owner-${Date.now()}@example.test`
    const owner = await db.user.create({
      data: {
        name: faker.person.fullName(),
        email: ownerEmail,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const company = await db.company.create({
      data: {
        legalName: faker.company.name(),
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    })
    await db.companyMember.create({
      data: { companyId: company.id, userId: owner.id, role: 'OWNER' },
    })
    const job = await db.job.create({
      data: {
        companyId: company.id,
        createdById: owner.id,
        title: faker.person.jobTitle(),
        type: 'INTERNSHIP',
        description: 'An exciting internship opportunity.',
        status: 'PENDING_REVIEW',
        workMode: 'HYBRID',
      },
    })

    await expectPageHealthy(page, `/zh/admin/jobs/${job.id}`)
  })

  test('STUDENT: /zh/admin/jobs is redirected away', async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    await page.goto('/zh/admin/jobs')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(page.url()).not.toContain('/admin/jobs')
  })

  test('EMPLOYER: /zh/admin/jobs is redirected away', async ({ page }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })
    await page.goto('/zh/admin/jobs')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(page.url()).not.toContain('/admin/jobs')
  })
})
