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
import { stubTurnstile } from './helpers/turnstile'

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

    // Browser context A: admin logs in (will suspend later)
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await loginAs(adminPage, { role: 'ADMIN' })

    // Browser context B: student logs in with their real credentials
    const studentCtx = await browser.newContext()
    const studentPage = await studentCtx.newPage()
    await studentPage.setExtraHTTPHeaders({ 'x-real-ip': '198.18.100.2' })
    await stubTurnstile(studentPage)
    await studentPage.goto('/zh/login')
    await studentPage.fill('[name="email"]', email)
    await studentPage.fill('[name="password"]', password)
    await studentPage.waitForFunction(
      () => { const btn = document.querySelector<HTMLButtonElement>('button[type="submit"]'); return btn !== null && !btn.disabled },
      { timeout: 10_000 },
    )
    await studentPage.click('button[type="submit"]')
    await studentPage.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })

    // Assert the student can access /zh/s before suspension
    await studentPage.goto('/zh/s')
    await studentPage.waitForLoadState('networkidle').catch(() => {})
    expect(studentPage.url()).not.toMatch(/\/login/)

    // Admin navigates to student detail and suspends them
    await adminPage.goto(`/zh/admin/students/${student.id}`)
    await adminPage.waitForSelector('[id="suspend-reason"]')
    await adminPage.fill('[id="suspend-reason"]', 'E2E suspend test')
    const responsePromise = adminPage.waitForResponse(
      (r) => r.url().includes('/zh/admin/students/') && r.status() === 200,
    )
    await adminPage.click('button[type="submit"]:has-text("停用账号"), button[type="submit"]:has-text("Suspend Account")')
    await responsePromise

    // Student navigates to /zh/s — session is deleted by suspension, requireStudent throws
    // ForbiddenError, layout redirects to /zh/login with NO redirect= param
    // (proves the server-side requireStudent path, not the "no session" proxy path)
    await studentPage.goto('/zh/s')
    await studentPage.waitForURL(/\/zh\/login/, { timeout: 30_000 })
    const finalUrl = new URL(studentPage.url())
    expect(finalUrl.pathname).toBe('/zh/login')
    expect(finalUrl.searchParams.has('redirect')).toBe(false)

    await adminCtx.close()
    await studentCtx.close()
  })
})
