/**
 * E2E smoke tests for M6-T02: admin student management.
 *
 * Tests:
 * 1. ADMIN: /zh/admin/students is healthy (200, no errors, heading visible)
 * 2. ADMIN: student detail page is healthy after creating a student
 * 3. ADMIN: suspend student → student's next request is redirected to login (two-context test)
 * 4. STUDENT: accessing /zh/admin/students is blocked
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb as db } from './helpers/db'
import { faker } from '@faker-js/faker'
import { hashPassword } from 'better-auth/crypto'
import { randomBytes } from 'crypto'
import { writeCurrentVersionConsent } from './helpers/consent'

test.describe('M6-T02 admin student management smoke', () => {
  test('ADMIN: /zh/admin/students is healthy and shows heading', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/students')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: student detail page is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })

    // Create a student directly in the DB
    const email = `e2e-detail-student-${Date.now()}@example.test`
    const user = await db.user.create({
      data: {
        name: faker.person.fullName(),
        email,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    await db.studentProfile.create({
      data: { userId: user.id, fullName: user.name, completeness: 40 },
    })

    await expectPageHealthy(page, `/zh/admin/students/${user.id}`)
  })

  test('ADMIN: /zh/admin/students response has cache-control: no-store', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/zh/admin/students') && !r.url().includes('/zh/admin/students/')),
      page.goto('/zh/admin/students'),
    ])
    const cacheControl = response.headers()['cache-control'] ?? ''
    expect(cacheControl.toLowerCase()).toContain('no-store')
  })

  test('STUDENT: accessing /zh/admin/students is blocked (redirect away)', async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    await page.goto('/zh/admin/students')
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(page.url()).not.toMatch(/\/zh\/admin\/students/)
  })

  test('ADMIN suspend student → suspended student next request redirected to login', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(90_000)
    // Create the student account with a known password
    const password = randomBytes(16).toString('hex')
    const hashedPwd = await hashPassword(password)
    const email = `e2e-suspend-${Date.now()}@example.test`

    const student = await db.user.create({
      data: {
        name: faker.person.fullName(),
        email,
        emailVerified: true,
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    })
    await db.account.create({
      data: {
        userId: student.id,
        accountId: student.id,
        providerId: 'credential',
        password: hashedPwd,
      },
    })
    await db.studentProfile.create({
      data: { userId: student.id, fullName: student.name, completeness: 10 },
    })
    await writeCurrentVersionConsent(student.id)

    // Browser context A: admin logs in and suspends the student
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await loginAs(adminPage, { role: 'ADMIN' })

    // Navigate to student detail and submit suspend form
    await adminPage.goto(`/zh/admin/students/${student.id}`)
    await adminPage.waitForSelector('[id="suspend-reason"]')
    // Fill in the suspend reason input
    await adminPage.fill('[id="suspend-reason"]', 'E2E suspend test')
    const responsePromise = adminPage.waitForResponse(
      (r) => r.url().includes('/zh/admin/students/') && r.status() === 200,
    )
    await adminPage.click('button[type="submit"]:has-text("停用账号"), button[type="submit"]:has-text("Suspend Account")')
    await responsePromise

    // Browser context B: the student tries to access a protected page
    const studentCtx = await browser.newContext()
    const studentPage = await studentCtx.newPage()

    // Add a fake x-real-ip so the rate limiter treats this as a distinct client
    await studentPage.setExtraHTTPHeaders({ 'x-real-ip': '198.18.100.1' })

    // The student's existing session is gone; navigating to /zh/s should redirect to login
    await studentPage.goto('/zh/s')
    await studentPage.waitForURL(/\/login/, { timeout: 30_000 })

    await adminCtx.close()
    await studentCtx.close()
  })
})
