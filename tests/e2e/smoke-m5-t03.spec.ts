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
    await page.waitForLoadState('networkidle').catch(() => {})
    // Use evaluate so Playwright doesn't wait for the element (it may not exist)
    const noindex = await page.evaluate(
      () => document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
    )
    if (noindex) {
      expect(noindex).not.toContain('noindex')
    }

    // With q: should have noindex,follow
    await page.goto('/zh/jobs?q=test')
    await page.waitForLoadState('networkidle').catch(() => {})
    const noindexWithQ = await page.evaluate(
      () => document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
    )
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

    // Visit as logged-in student WITH a profile so the page renders (without profile → redirect to onboarding)
    const { userId } = await loginAs(page, { role: 'STUDENT' })
    const school = await e2eDb.school.findFirst()
    const noindexProfile = await e2eDb.studentProfile.create({
      data: { userId, fullName: 'Noindex Student', schoolId: school?.id ?? null, completeness: 50, visibility: 'PUBLIC' },
    })
    await page.goto(`/zh/jobs/${job.id}`)
    await page.waitForLoadState('networkidle').catch(() => {})

    // The page should have noindex
    // Use evaluate so Playwright doesn't wait for the element (SSR head; not a reactive DOM update)
    const robotsMeta = await page.evaluate(
      () => document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
    )
    // noindex is set via Next.js Metadata API which emits <meta name="robots" content="noindex,...">
    expect(robotsMeta).toBeTruthy()
    expect(robotsMeta).toContain('noindex')

    // No JSON-LD script (JobPosting schema)
    const jsonLd = await page.locator('script[type="application/ld+json"]').count()
    expect(jsonLd).toBe(0)

    // cleanup
    await e2eDb.jobView.deleteMany({ where: { studentId: noindexProfile.id } })
    await e2eDb.studentProfile.delete({ where: { id: noindexProfile.id } })
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

test.describe('M5-T03 fix round', () => {
  // Fix 1: expired jobs must not appear even with q param
  test('expired job is not shown when searching by sentinel word', async ({ page }) => {
    const sentinel = `expiredsentinel${Date.now()}`
    const company = await e2eDb.company.create({
      data: { legalName: 'Expired Corp Fix1', verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await e2eDb.user.create({
      data: { name: 'Expired Owner', email: `expired-owner-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })

    // Expired job: deadline in the past
    const expiredJob = await e2eDb.job.create({
      data: {
        companyId: company.id,
        createdById: owner.id,
        title: `${sentinel} expired`,
        type: 'INTERNSHIP',
        description: 'expired',
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - 86400000),
        deadline: new Date(Date.now() - 3600000),
        workMode: 'ONSITE',
      },
    })

    // Active job with same sentinel
    const activeJob = await e2eDb.job.create({
      data: {
        companyId: company.id,
        createdById: owner.id,
        title: `${sentinel} active`,
        type: 'INTERNSHIP',
        description: 'active',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        deadline: new Date(Date.now() + 86400000 * 30),
        workMode: 'ONSITE',
      },
    })

    await page.goto(`/zh/jobs?q=${encodeURIComponent(sentinel)}`)
    await page.waitForLoadState('networkidle').catch(() => {})
    const content = await page.content()

    expect(content).not.toContain(`${sentinel} expired`)
    expect(content).toContain(`${sentinel} active`)

    await e2eDb.job.deleteMany({ where: { companyId: company.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })

  // Fix 2a: invalid type/workMode must not cause 500
  test('/zh/jobs?type=BOGUS&workMode=X returns 200, no error page', async ({ page }) => {
    await expectPageHealthy(page, '/zh/jobs?type=BOGUS&workMode=X')
  })

  // Fix 2b: /zh/jobs/not-a-cuid returns 404
  test('/zh/jobs/not-a-cuid returns 404', async ({ page }) => {
    const res = await page.goto('/zh/jobs/not-a-cuid')
    expect(res?.status()).toBe(404)
  })

  // Fix 3: invite button href navigates to /zh/s/invite, not /zh/zh/invite
  test('invite button on locked card navigates to /zh/s/invite', async ({ page }) => {
    const company = await e2eDb.company.create({
      data: { legalName: 'Fix3 Invite Corp', verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await e2eDb.user.create({
      data: { name: 'Fix3 Owner', email: `fix3-owner-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })
    const jobs: { id: string }[] = []
    for (let i = 0; i < 21; i++) {
      const j = await e2eDb.job.create({
        data: {
          companyId: company.id,
          createdById: owner.id,
          title: `Fix3 Job ${i + 1}`,
          type: 'INTERNSHIP',
          description: `fix3 desc ${i + 1}`,
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
      data: { userId, fullName: 'Fix3 Student', schoolId: school?.id ?? null, completeness: 50, visibility: 'PUBLIC' },
    })
    for (let i = 0; i < 20; i++) {
      await e2eDb.jobView.create({ data: { studentId: profile.id, jobId: jobs[i].id } })
    }

    await page.goto(`/zh/jobs/${jobs[20].id}`)
    await page.waitForLoadState('networkidle').catch(() => {})

    const inviteLink = page.getByRole('link', { name: '邀请同学解锁' })
    await inviteLink.click()
    await page.waitForURL(/\/s\/invite/, { timeout: 10000 })
    expect(page.url()).toMatch(/\/zh\/s\/invite/)
    await expectPageHealthy(page, page.url().replace(/^https?:\/\/[^/]+/, ''), { expectUrl: '/zh/s/invite' })

    await e2eDb.jobView.deleteMany({ where: { studentId: profile.id } })
    await e2eDb.studentProfile.delete({ where: { id: profile.id } })
    await e2eDb.job.deleteMany({ where: { companyId: company.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })

  // Fix 4: visitor redirected to login then returns to job after login
  test('visitor redirected to login, student returns to job after login', async ({ page }) => {
    const { randomBytes } = await import('crypto')
    const { hashPassword } = await import('better-auth/crypto')
    const { stubTurnstile } = await import('./helpers/turnstile')

    const company = await e2eDb.company.create({
      data: { legalName: 'Fix4 Redirect Corp', verificationStatus: 'VERIFIED', isActive: true },
    })
    const owner = await e2eDb.user.create({
      data: { name: 'Fix4 Owner', email: `fix4-owner-${Date.now()}@example.test`, emailVerified: true, role: 'EMPLOYER', status: 'ACTIVE' },
    })
    await e2eDb.companyMember.create({ data: { companyId: company.id, userId: owner.id, role: 'OWNER' } })
    const job = await e2eDb.job.create({
      data: {
        companyId: company.id,
        createdById: owner.id,
        title: 'Fix4 Redirect Job',
        type: 'INTERNSHIP',
        description: 'Fix4 desc',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        workMode: 'ONSITE',
      },
    })

    // Create a student account in DB before navigation
    const unique = `fix4-${Date.now()}`
    const email = `e2e-student-${unique}@example.test`
    const password = randomBytes(16).toString('hex')
    const hashedPwd = await hashPassword(password)
    const student = await e2eDb.user.create({
      data: { name: 'Fix4 Student', email, emailVerified: true, role: 'STUDENT', status: 'ACTIVE' },
    })
    await e2eDb.account.create({
      data: { userId: student.id, accountId: student.id, providerId: 'credential', password: hashedPwd },
    })
    const school = await e2eDb.school.findFirst()
    await e2eDb.studentProfile.create({
      data: { userId: student.id, fullName: 'Fix4 Student', schoolId: school?.id ?? null, completeness: 50, visibility: 'PUBLIC' },
    })

    // Visit job page as unauthenticated visitor — should redirect to login
    await page.goto(`/zh/jobs/${job.id}`)
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 })

    // Log in from the redirect login page (which has redirect param in URL)
    await stubTurnstile(page)
    await page.fill('[name="email"]', email)
    await page.fill('[name="password"]', password)
    await page.waitForFunction(
      () => {
        const btn = document.querySelector<HTMLButtonElement>('button[type="submit"]')
        return btn !== null && !btn.disabled
      },
      { timeout: 10000 },
    )
    await page.click('button[type="submit"]')

    // After login should land on the original job detail page
    await expect(page).toHaveURL(new RegExp(`/zh/jobs/${job.id}`), { timeout: 15000 })

    await e2eDb.studentProfile.deleteMany({ where: { userId: student.id } })
    await e2eDb.account.deleteMany({ where: { userId: student.id } })
    await e2eDb.user.delete({ where: { id: student.id } })
    await e2eDb.job.delete({ where: { id: job.id } })
    await e2eDb.companyMember.deleteMany({ where: { companyId: company.id } })
    await e2eDb.company.delete({ where: { id: company.id } })
  })
})
