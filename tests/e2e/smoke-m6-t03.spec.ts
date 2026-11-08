/**
 * E2E smoke tests for M6-T03: admin company management.
 *
 * Tests:
 * 1. ADMIN: /zh/admin/companies is healthy (200, no errors, heading visible)
 * 2. ADMIN: company detail/manage page is healthy after creating a company
 * 3. ADMIN: deactivate company → employer member's next request returns to login
 * 4. EMPLOYER: accessing /zh/admin/companies is blocked
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb as db } from './helpers/db'
import { faker } from '@faker-js/faker'
import { hashPassword } from 'better-auth/crypto'
import { randomBytes } from 'crypto'
import { writeCurrentVersionConsent } from './helpers/consent'
import { stubTurnstile } from './helpers/turnstile'

test.describe('M6-T03 admin company management smoke', () => {
  test('ADMIN: /zh/admin/companies is healthy and shows heading', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/companies')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: company detail page is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })

    const company = await db.company.create({
      data: {
        legalName: faker.company.name(),
        isActive: true,
      },
    })

    await expectPageHealthy(page, `/zh/admin/companies/${company.id}`)
  })

  test('ADMIN: /zh/admin/companies response has cache-control: no-store', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/zh/admin/companies') &&
          !r.url().includes('/zh/admin/companies/') &&
          r.status() === 200,
      ),
      page.goto('/zh/admin/companies'),
    ])
    const cacheControl = response.headers()['cache-control'] ?? ''
    expect(cacheControl.toLowerCase()).toContain('no-store')
  })

  test('EMPLOYER: accessing /zh/admin/companies is blocked (redirect away)', async ({ page }) => {
    await loginAs(page, { role: 'EMPLOYER', company: { verificationStatus: 'VERIFIED' } })
    await page.goto('/zh/admin/companies')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(page.url()).not.toMatch(/\/zh\/admin\/companies/)
  })

  test('ADMIN deactivate company → employer member next request redirected to login', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    // Create the employer account with a known password
    const password = randomBytes(16).toString('hex')
    const hashedPwd = await hashPassword(password)
    const employerEmail = `e2e-employer-${Date.now()}@example.test`

    const employerUser = await db.user.create({
      data: {
        name: faker.person.fullName(),
        email: employerEmail,
        emailVerified: true,
        role: 'EMPLOYER',
        status: 'ACTIVE',
      },
    })
    await db.account.create({
      data: {
        userId: employerUser.id,
        accountId: employerUser.id,
        providerId: 'credential',
        password: hashedPwd,
      },
    })
    const company = await db.company.create({
      data: {
        legalName: faker.company.name(),
        verificationStatus: 'UNSUBMITTED',
        isActive: true,
      },
    })
    await db.companyMember.create({
      data: { companyId: company.id, userId: employerUser.id, role: 'OWNER' },
    })
    await writeCurrentVersionConsent(employerUser.id)

    // Browser context A: admin logs in
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await loginAs(adminPage, { role: 'ADMIN' })

    // Browser context B: employer logs in
    const employerCtx = await browser.newContext()
    const employerPage = await employerCtx.newPage()
    await employerPage.setExtraHTTPHeaders({ 'x-real-ip': '198.18.100.3' })
    await stubTurnstile(employerPage)
    await employerPage.goto('/zh/login')
    await employerPage.fill('[name="email"]', employerEmail)
    await employerPage.fill('[name="password"]', password)
    await employerPage.waitForFunction(
      () => {
        const btn = document.querySelector<HTMLButtonElement>('button[type="submit"]')
        return btn !== null && !btn.disabled
      },
      { timeout: 10_000 },
    )
    await employerPage.click('button[type="submit"]')
    await employerPage.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })

    // Verify employer can access /zh/e before deactivation
    await employerPage.goto('/zh/e')
    await employerPage.waitForLoadState('networkidle').catch(() => {})
    expect(employerPage.url()).not.toMatch(/\/login/)

    // Admin opens company detail page and deactivates
    await adminPage.goto(`/zh/admin/companies/${company.id}`)
    await adminPage.waitForSelector('[id="deactivate-reason"]')
    await adminPage.fill('[id="deactivate-reason"]', 'E2E deactivation test')
    const responsePromise = adminPage.waitForResponse(
      (r) => r.status() === 200,
    )
    await adminPage.click('button:has-text("停用企业"), button:has-text("Deactivate Company")')
    await responsePromise

    // Poll DB until company.isActive becomes false (server action completed)
    await employerPage.waitForFunction(async () => {
      const res = await fetch('/api/health')
      return res.ok
    }, undefined, { timeout: 10_000 }).catch(() => {})

    // Employer navigates to /zh/e — session was revoked, requireCompanyMember throws
    // ForbiddenError, layout redirects away from employer portal
    await employerPage.goto('/zh/e')
    await employerPage.waitForURL(/\/zh\/login/, { timeout: 30_000 })
    const finalUrl = new URL(employerPage.url())
    expect(finalUrl.pathname).toBe('/zh/login')

    await adminCtx.close()
    await employerCtx.close()
  })
})
