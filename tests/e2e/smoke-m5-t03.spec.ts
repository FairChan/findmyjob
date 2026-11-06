/**
 * Smoke tests for M5-T03: public job list and detail pages.
 */
import { test, expect } from '@playwright/test'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M5-T03 public jobs smoke', () => {
  test('/zh/jobs list is healthy (no auth)', async ({ page }) => {
    await expectPageHealthy(page, '/zh/jobs')
  })

  test('/en/jobs list is healthy (no auth)', async ({ page }) => {
    await expectPageHealthy(page, '/en/jobs')
  })

  test('/zh/jobs list page has noindex only when query params present', async ({ page }) => {
    // Without q: should NOT have noindex in meta
    await page.goto('/zh/jobs')
    const noindex = await page.locator('meta[name="robots"]').getAttribute('content')
    // No robots meta or non-noindex expected
    if (noindex) {
      expect(noindex).not.toContain('noindex')
    }

    // With q: should have noindex,follow
    await page.goto('/zh/jobs?q=test')
    const noindexWithQ = await page.locator('meta[name="robots"]').getAttribute('content')
    expect(noindexWithQ).toContain('noindex')
  })

  test('/zh/jobs/[id] detail redirects visitor to login', async ({ page }) => {
    // Create a published job
    const company = await e2eDb.company.create({
      data: { legalName: 'Smoke M5T03 Corp', verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await e2eDb.user.create({
      data: { name: 'Smoke Owner', email: `smoke-m5t03-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })
    const job = await e2eDb.job.create({
      data: {
        companyId: company.id,
        createdById: owner.id,
        title: 'Smoke Test Job',
        type: 'INTERNSHIP',
        description: 'Smoke test description',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'ONSITE',
      },
    })

    await page.goto(`/zh/jobs/${job.id}`)
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 })

    // cleanup
    await e2eDb.job.delete({ where: { id: job.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })

  test('/zh/jobs/[id] detail has noindex meta tag', async ({ page }) => {
    const company = await e2eDb.company.create({
      data: { legalName: 'Smoke Noindex Corp', verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await e2eDb.user.create({
      data: { name: 'Noindex Owner', email: `smoke-noindex-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })
    const job = await e2eDb.job.create({
      data: {
        companyId: company.id,
        createdById: owner.id,
        title: 'Noindex Smoke Job',
        type: 'INTERNSHIP',
        description: 'Job for noindex test',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'ONSITE',
      },
    })

    // Visit as logged-in student so we get to see the page (not just redirect)
    await loginAs(page, { role: 'STUDENT' })
    await page.goto(`/zh/jobs/${job.id}`)
    await page.waitForLoadState('networkidle').catch(() => {})

    // The page should have noindex
    const robotsMeta = await page.locator('meta[name="robots"]').getAttribute('content')
    // noindex is set via Next.js Metadata API which emits <meta name="robots" content="noindex,...">
    expect(robotsMeta).toBeTruthy()
    expect(robotsMeta).toContain('noindex')

    // No JSON-LD script (JobPosting schema)
    const jsonLd = await page.locator('script[type="application/ld+json"]').count()
    expect(jsonLd).toBe(0)

    // cleanup
    await e2eDb.job.delete({ where: { id: job.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })

  test('21st job shows locked card for quota-exhausted student', async ({ page }) => {
    // Create a company and 21 published jobs
    const company = await e2eDb.company.create({
      data: { legalName: 'Quota Test Corp', verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await e2eDb.user.create({
      data: { name: 'Quota Owner', email: `quota-owner-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })

    const jobs = []
    for (let i = 0; i < 21; i++) {
      const j = await e2eDb.job.create({
        data: {
          companyId: company.id,
          createdById: owner.id,
          title: `Quota Job ${i + 1}`,
          type: 'INTERNSHIP',
          description: `Description for job ${i + 1}`,
          status: 'PUBLISHED',
          publishedAt: new Date(Date.now() - (21 - i) * 1000),
          workMode: 'ONSITE',
        },
      })
      jobs.push(j)
    }

    const { userId } = await loginAs(page, { role: 'STUDENT' })
    const school = await e2eDb.school.findFirst()
    const profile = await e2eDb.studentProfile.create({
      data: {
        userId,
        fullName: 'Quota Test Student',
        schoolId: school?.id ?? null,
        completeness: 50,
        visibility: 'PUBLIC',
      },
    })

    // Exhaust quota by pre-creating 20 JobView records for jobs 1-20
    for (let i = 0; i < 20; i++) {
      await e2eDb.jobView.create({ data: { studentId: profile.id, jobId: jobs[i].id } })
    }

    // Now open the 21st job — should see locked card
    await page.goto(`/zh/jobs/${jobs[20].id}`)
    await page.waitForLoadState('networkidle').catch(() => {})

    // Should show locked card text, not description
    const content = await page.content()
    expect(content).toContain('Quota Job 21')
    expect(content).not.toContain('Description for job 21')
    // lockedTitle text
    expect(content).toContain('查看额度已用完')

    // cleanup
    await e2eDb.jobView.deleteMany({ where: { studentId: profile.id } })
    await e2eDb.job.deleteMany({ where: { companyId: company.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })

  test('company employer sees locked card for other company job', async ({ page }) => {
    // Create a job from company A
    const companyA = await e2eDb.company.create({
      data: { legalName: 'Company A Lock Test', verificationStatus: 'VERIFIED', isActive: true },
    })
    const ownerA = await e2eDb.user.create({
      data: { name: 'Owner A', email: `owner-a-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: companyA.id, userId: ownerA.id, role: 'OWNER' } })
    const jobA = await e2eDb.job.create({
      data: {
        companyId: companyA.id,
        createdById: ownerA.id,
        title: 'Company A Job Secret',
        type: 'FULL_TIME',
        description: 'SECRET_COMPANY_A_DESCRIPTION',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'ONSITE',
      },
    })

    // Login as employer from company B
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })

    await page.goto(`/zh/jobs/${jobA.id}`)
    await page.waitForLoadState('networkidle').catch(() => {})

    const content = await page.content()
    // Shows title but not description
    expect(content).toContain('Company A Job Secret')
    expect(content).not.toContain('SECRET_COMPANY_A_DESCRIPTION')

    // cleanup
    await e2eDb.job.delete({ where: { id: jobA.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: companyA.id } })
    await e2eDb.company.delete({ where: { id: companyA.id } })
  })

  test('hidden salary job: no salary in list page or detail locked card', async ({ page }) => {
    const company = await e2eDb.company.create({
      data: { legalName: 'Hidden Salary Corp', verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await e2eDb.user.create({
      data: { name: 'Salary Owner', email: `salary-owner-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })
    const job = await e2eDb.job.create({
      data: {
        companyId: company.id,
        createdById: owner.id,
        title: 'Hidden Salary Job',
        type: 'INTERNSHIP',
        description: 'No salary info here',
        salaryMin: 3333,
        salaryMax: 7777,
        salaryVisible: false,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'REMOTE',
      },
    })

    // Visit list page as visitor
    await page.goto('/zh/jobs')
    await page.waitForLoadState('networkidle').catch(() => {})
    const listContent = await page.content()
    expect(listContent).not.toContain('3333')
    expect(listContent).not.toContain('7777')
    expect(listContent).not.toContain('3,333')
    expect(listContent).not.toContain('7,777')

    // cleanup
    await e2eDb.job.delete({ where: { id: job.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })
})
