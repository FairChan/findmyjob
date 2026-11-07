/**
 * Smoke tests for M5-T10: extended job filters (industry, tags, size, salary band).
 */
import { test, expect } from '@playwright/test'
import { e2eDb } from './helpers/db'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M5-T10 extended filter smoke', () => {
  test('/zh/jobs is healthy with industry filter', async ({ page }) => {
    await expectPageHealthy(page, '/zh/jobs?industry=finance')
  })

  test('/zh/jobs is healthy with salary filter', async ({ page }) => {
    await expectPageHealthy(page, '/zh/jobs?salary=3000')
  })

  test('/zh/jobs is healthy with tags filter', async ({ page }) => {
    await expectPageHealthy(page, '/zh/jobs?tags=SOE%2CFORTUNE_500')
  })

  test('/zh/jobs is healthy with size filter', async ({ page }) => {
    await expectPageHealthy(page, '/zh/jobs?size=S51_200')
  })

  test('/zh/jobs with industry filter shows matching job', async ({ page }) => {
    const sentinel = `smokeM5T10_ind_${Date.now()}`
    const owner = await e2eDb.user.create({
      data: {
        name: 'M5T10 Owner',
        email: `m5t10-owner-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const bankCo = await e2eDb.company.create({
      data: {
        legalName: `M5T10 BankCorp ${sentinel}`,
        verificationStatus: 'VERIFIED',
        isActive: true,
        industryCode: 'finance.bank',
      },
    })
    const otherCo = await e2eDb.company.create({
      data: {
        legalName: `M5T10 TechCorp ${sentinel}`,
        verificationStatus: 'VERIFIED',
        isActive: true,
        industryCode: 'tech.software',
      },
    })
    await e2eDb.companyMember.create({
      data: { companyId: bankCo.id, userId: owner.id, role: 'OWNER' },
    })
    const bankJob = await e2eDb.job.create({
      data: {
        companyId: bankCo.id,
        createdById: owner.id,
        title: `${sentinel} Banking Analyst`,
        type: 'INTERNSHIP',
        description: 'Finance filter smoke',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'ONSITE',
      },
    })
    const techJob = await e2eDb.job.create({
      data: {
        companyId: otherCo.id,
        createdById: owner.id,
        title: `${sentinel} Software Engineer`,
        type: 'INTERNSHIP',
        description: 'Tech filter smoke',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'ONSITE',
      },
    })

    await page.goto(`/zh/jobs?industry=finance`)
    await page.waitForLoadState('networkidle').catch(() => {})
    const content = await page.content()
    expect(content).toContain(`${sentinel} Banking Analyst`)
    expect(content).not.toContain(`${sentinel} Software Engineer`)

    // cleanup
    await e2eDb.job.deleteMany({ where: { id: { in: [bankJob.id, techJob.id] } } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: bankCo.id } })
    await e2eDb.company.deleteMany({ where: { id: { in: [bankCo.id, otherCo.id] } } })
    await e2eDb.user.delete({ where: { id: owner.id } })
  })

  test('/zh/jobs salary filter excludes hidden-salary jobs', async ({ page }) => {
    const sentinel = `smokeM5T10_sal_${Date.now()}`
    const owner = await e2eDb.user.create({
      data: {
        name: 'M5T10 SalOwner',
        email: `m5t10-sal-${Date.now()}@example.test`,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    const co = await e2eDb.company.create({
      data: { legalName: `M5T10 SalCorp ${sentinel}`, verificationStatus: 'VERIFIED', isActive: true },
    })
    const hiddenJob = await e2eDb.job.create({
      data: {
        companyId: co.id,
        createdById: owner.id,
        title: `${sentinel} hidden-sal-job`,
        type: 'INTERNSHIP',
        description: 'hidden salary smoke',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'ONSITE',
        salaryMax: 9000,
        salaryVisible: false,
      },
    })

    await page.goto(`/zh/jobs?salary=3000`)
    await page.waitForLoadState('networkidle').catch(() => {})
    const content = await page.content()
    expect(content).not.toContain(`${sentinel} hidden-sal-job`)

    // cleanup
    await e2eDb.job.delete({ where: { id: hiddenJob.id } })
    await e2eDb.company.delete({ where: { id: co.id } })
    await e2eDb.user.delete({ where: { id: owner.id } })
  })
})
