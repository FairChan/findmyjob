/**
 * Smoke tests for M5-T09: job search service and paginated /jobs page.
 */
import { test, expect } from '@playwright/test'
import { e2eDb } from './helpers/db'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M5-T09 job search smoke', () => {
  test('/zh/jobs is healthy (no auth)', async ({ page }) => {
    await expectPageHealthy(page, '/zh/jobs')
  })

  test('/en/jobs is healthy (no auth)', async ({ page }) => {
    await expectPageHealthy(page, '/en/jobs')
  })

  test('/zh/jobs?q=abc returns 200 with no error boundary', async ({ page }) => {
    await expectPageHealthy(page, '/zh/jobs?q=abc')
  })

  test('/zh/jobs search by title shows matching job', async ({ page }) => {
    const sentinel = `smokeM5T09_${Date.now()}`
    const company = await e2eDb.company.create({
      data: { legalName: `M5T09 Corp ${sentinel}`, verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await e2eDb.user.create({
      data: { name: 'M5T09 Owner', email: `m5t09-owner-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })
    const job = await e2eDb.job.create({
      data: {
        companyId: company.id,
        createdById: owner.id,
        title: `${sentinel} 财务助理`,
        type: 'INTERNSHIP',
        description: 'Job description for smoke test',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'ONSITE',
      },
    })

    await page.goto(`/zh/jobs?q=${encodeURIComponent(sentinel)}`)
    await page.waitForLoadState('networkidle').catch(() => {})
    const content = await page.content()
    expect(content).toContain(`${sentinel} 财务助理`)

    // cleanup
    await e2eDb.job.delete({ where: { id: job.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })

  test('/zh/jobs does not show expired jobs', async ({ page }) => {
    const sentinel = `expiredM5T09_${Date.now()}`
    const company = await e2eDb.company.create({
      data: { legalName: `Expired Corp ${sentinel}`, verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await e2eDb.user.create({
      data: { name: 'M5T09 Expired Owner', email: `m5t09-exp-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })
    await e2eDb.job.create({
      data: {
        companyId: company.id,
        createdById: owner.id,
        title: `${sentinel} expired job`,
        type: 'INTERNSHIP',
        description: 'expired',
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - 86400000),
        deadline: new Date(Date.now() - 3600000),
        workMode: 'ONSITE',
      },
    })

    await page.goto(`/zh/jobs?q=${encodeURIComponent(sentinel)}`)
    await page.waitForLoadState('networkidle').catch(() => {})
    const content = await page.content()
    expect(content).not.toContain(`${sentinel} expired job`)

    // cleanup
    await e2eDb.job.deleteMany({ where: { companyId: company.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })
})
