/**
 * Frontend redesign P2: the four shells (public, auth, workspace, admin).
 * Each page has exactly one main landmark, the workspace navigation reflects the
 * member's role, and the public nav is down to four destinations.
 *
 * Set REDESIGN_SHOT_DIR to also write full-page screenshots there.
 */
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers/session'
import { e2eDb } from './helpers/db'

const shotDir = process.env.REDESIGN_SHOT_DIR

async function shot(page: Page, name: string) {
  if (!shotDir) return
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true })
}

async function expectSingleMain(page: Page) {
  await expect(page.locator('main')).toHaveCount(1)
  await expect(page.locator('#main-content')).toHaveCount(1)
}

test.describe('redesign: public and auth shells', () => {
  test('public nav has four destinations and the wordmark leads home', async ({ page }) => {
    await page.goto('/zh/jobs')
    const nav = page.getByRole('navigation', { name: '主导航' })
    await expect(nav.getByRole('link')).toHaveText(['职位', '企业', '招聘合作', '求职防骗'])
    await page.locator('header').getByRole('link', { name: 'FindMYJob' }).click()
    await expect(page).toHaveURL(/\/zh$/)
    await expectSingleMain(page)
  })

  test('auth pages keep only the way home, the language switch and legal links', async ({ page }) => {
    await page.goto('/zh/login')
    await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
    await expect(page.locator('header').getByRole('link', { name: 'FindMYJob' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '隐私政策' })).toBeVisible()
    await expectSingleMain(page)
    await shot(page, 'login-zh-1440')
  })

  test('unknown pages get the designed 404 inside the public shell', async ({ page }) => {
    const res = await page.goto('/zh/companies/does-not-exist')
    expect(res?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: '没有找到这个页面' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
    await shot(page, 'not-found-zh-1440')
  })
})

test.describe('redesign: workspace shells', () => {
  test('student: navigation marks the current page and the avatar opens profile and sign-out', async ({ page }) => {
    const { userId } = await loginAs(page, { role: 'STUDENT' })
    await e2eDb.studentProfile.create({
      data: { userId, fullName: 'Shell Student', completeness: 80, visibility: 'PUBLIC', onboardingStep: 5 },
    })
    await page.goto('/zh/s/profile')
    const nav = page.getByRole('navigation', { name: '学生导航', exact: true })
    await expect(nav.getByRole('link', { name: '工作台', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link')).toHaveCount(6)
    await nav.getByRole('link', { name: '找职位', exact: true }).click()
    await expect(nav.getByRole('link', { name: '找职位', exact: true })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: '账户菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: '个人资料', exact: true }).click()
    await expect(page).toHaveURL(/\/zh\/s\/profile$/)
    await expectSingleMain(page)
    await shot(page, 'student-profile-zh-1440')

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/zh/s/profile')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await shot(page, 'student-profile-zh-375')

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByRole('button', { name: '账户菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).click()
    await expect(page).toHaveURL(/\/zh\/login/)
  })

  test('employer: owner sees company, verification and billing links', async ({ page }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'OWNER', isActive: true },
    })
    await page.goto('/zh/e')
    const nav = page.getByRole('navigation', { name: '企业导航' })
    await expect(nav.getByRole('link', { name: '职位管理', exact: true })).toHaveAttribute('aria-current', 'page')
    for (const name of ['职位管理', '人才库']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: '账户菜单', exact: true }).click()
    for (const name of ['企业资料', '认证材料', '订单与账单']) {
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expectSingleMain(page)
    await shot(page, 'employer-home-zh-1440')

    // Email preferences stay reachable from the top bar at every width.
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('button', { name: '账户菜单', exact: true }).click()
    await expect(page.getByRole('menu').locator('a[href="/zh/e/preferences"]')).toBeVisible()
    await page.keyboard.press('Escape')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await shot(page, 'employer-home-zh-375')
    await page.setViewportSize({ width: 1280, height: 800 })

    // The shell must not add a second aside next to the talent filters.
    await page.goto('/zh/e/talent')
    expect(await page.locator('aside').count()).toBeLessThanOrEqual(1)
    await expectSingleMain(page)
    await shot(page, 'employer-talent-zh-1440')
  })

  test('employer: recruiter does not see owner-only links', async ({ page }) => {
    await loginAs(page, {
      role: 'EMPLOYER',
      company: { verificationStatus: 'VERIFIED', memberRole: 'RECRUITER', isActive: true },
    })
    await page.goto('/en/e')
    const nav = page.getByRole('navigation', { name: 'Employer navigation' })
    await expect(nav.getByRole('link', { name: 'Talent pool', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Team', exact: false })).toBeVisible()
    // Role never hides the personal email preferences link.
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /Billing|Orders|Verification|Company details/ })).toHaveCount(0)
    await expect(page.getByRole('menu').locator('a[href="/en/e/preferences"]')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('admin: light sidebar, one main, language switch stays available', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await page.goto('/zh/admin')
    await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
    await expectSingleMain(page)
    await shot(page, 'admin-home-zh-1440')
  })
})
