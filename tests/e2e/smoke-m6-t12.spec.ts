/**
 * E2E smoke tests for M6-T12: admin companies list with verificationStatus filter.
 *
 * Tests:
 * 1. ADMIN: /zh/admin/companies?status=PENDING shows pending company, hides verified company
 * 2. ADMIN: detail page for non-existent companyId returns 404 (page shows "could not be found")
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { e2eDb as db } from './helpers/db'
import { faker } from '@faker-js/faker'

test.describe('M6-T12 admin companies verificationStatus filter smoke', () => {
  test('ADMIN: /zh/admin/companies?status=PENDING shows pending company and hides verified company', async ({
    page,
  }) => {
    await loginAs(page, { role: 'ADMIN' })

    const suffix = `${Date.now()}`
    const pendingName = `PendingCo-${suffix}`
    const verifiedName = `VerifiedCo-${suffix}`

    await db.company.create({
      data: { legalName: pendingName, verificationStatus: 'PENDING', isActive: true },
    })
    await db.company.create({
      data: { legalName: verifiedName, verificationStatus: 'VERIFIED', isActive: true },
    })

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/zh/admin/companies') && r.status() === 200,
      ),
      page.goto('/zh/admin/companies?status=PENDING'),
    ])
    expect(response.status()).toBe(200)

    await page.waitForLoadState('networkidle').catch(() => {})

    // No Next.js error overlays
    await expect(page.getByText('Unhandled Runtime Error')).not.toBeVisible({ timeout: 3000 })
    await expect(page.getByText('A server error occurred')).not.toBeVisible()
    await expect(page.getByText('Application error')).not.toBeVisible()

    // Pending company should appear, verified should not
    await expect(page.getByText(pendingName)).toBeVisible()
    await expect(page.getByText(verifiedName)).not.toBeVisible()
  })

  test('ADMIN: detail page for non-existent companyId returns 404', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    const fakeId = 'cnonexistentid00000000000'
    const res = await page.goto(`/zh/admin/companies/${fakeId}`)
    expect(res?.status()).toBe(404)
  })

  test('ADMIN: dashboard pending companies link goes to ?status=PENDING', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/zh/admin/companies') &&
          r.url().includes('status=PENDING') &&
          r.status() === 200,
      ),
      (async () => {
        await page.goto('/zh/admin')
        await page.waitForLoadState('networkidle').catch(() => {})
        // Click the "pending companies" stat card link
        const pendingLink = page.locator('a[href*="status=PENDING"]').first()
        await pendingLink.click()
      })(),
    ])
    expect(response.status()).toBe(200)
    expect(response.url()).toContain('status=PENDING')
  })
})

test.describe('M6-T12 jobs from deactivated company E2E', () => {
  test('EMPLOYER: after company deactivation, employer re-login cannot access /zh/e', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(90_000)

    const { hashPassword } = await import('better-auth/crypto')
    const { randomBytes } = await import('crypto')
    const { faker: fk } = await import('@faker-js/faker')
    const { writeCurrentVersionConsent } = await import('./helpers/consent')
    const { stubTurnstile } = await import('./helpers/turnstile')

    const password = randomBytes(16).toString('hex')
    const hashedPwd = await hashPassword(password)
    const employerEmail = `e2e-emp-t12-${Date.now()}@example.test`

    const employerUser = await db.user.create({
      data: {
        name: fk.person.fullName(),
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
      data: { legalName: fk.company.name(), verificationStatus: 'UNSUBMITTED', isActive: true },
    })
    await db.companyMember.create({
      data: { companyId: company.id, userId: employerUser.id, role: 'OWNER' },
    })
    await writeCurrentVersionConsent(employerUser.id)

    // Deactivate directly in DB (no need for admin browser session for this test)
    await db.company.update({ where: { id: company.id }, data: { isActive: false } })

    // Employer logs in AFTER deactivation
    const empCtx = await browser.newContext()
    const empPage = await empCtx.newPage()
    await empPage.setExtraHTTPHeaders({ 'x-real-ip': '198.18.200.1' })
    await stubTurnstile(empPage)
    await empPage.goto('/zh/login')
    await empPage.fill('[name="email"]', employerEmail)
    await empPage.fill('[name="password"]', password)
    await empPage.waitForFunction(
      () => {
        const btn = document.querySelector<HTMLButtonElement>('button[type="submit"]')
        return btn !== null && !btn.disabled
      },
      { timeout: 10_000 },
    )
    await empPage.click('button[type="submit"]')
    // Login may succeed (auth doesn't block deactivated companies at sign-in)
    await empPage.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 }).catch(() => {})

    // Accessing /zh/e should fail — requireCompanyMember checks isActive.
    // Member exists so the page re-throws ForbiddenError (no redirect to onboarding).
    // The layout only wraps requireEmployer, so the unhandled ForbiddenError from the page
    // results in a non-200 response rather than a redirect to login.
    const res = await empPage.goto('/zh/e')
    expect(res?.status()).not.toBe(200)

    await empCtx.close()
  })
})
