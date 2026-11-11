/**
 * Frontend redesign P5: the student workspace pages.
 * The pages are restyled, not rewired, so they are checked for one title each,
 * accessibility and width; the dashboard is also checked for where its links lead.
 *
 * Set REDESIGN_SHOT_DIR to also write full-page screenshots there.
 */
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb } from './helpers/db'

const shotDir = process.env.REDESIGN_SHOT_DIR

async function shot(page: Page, name: string) {
  if (!shotDir) return
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: true })
}

async function expectNoSeriousA11y(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const serious = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

const PAGES = [
  ['profile', '/s/profile'],
  ['resume', '/s/resume'],
  ['applications', '/s/applications'],
  ['invitations', '/s/invitations'],
  ['notifications', '/s/notifications'],
  ['invite', '/s/invite'],
  ['privacy', '/s/privacy'],
  ['settings', '/s/settings'],
  ['school-verify', '/s/school-verify'],
  ['contact', '/s/contact'],
] as const

async function loginStudent(page: Page) {
  const { userId } = await loginAs(page, { role: 'STUDENT' })
  await e2eDb.studentProfile.create({
    data: { userId, fullName: 'Redesign Student', completeness: 40, visibility: 'HIDDEN', onboardingStep: 5 },
  })
  return userId
}

test.describe('redesign: student workspace', () => {
  test('dashboard shows completeness and sends each task to the page that completes it', async ({ page }) => {
    await loginStudent(page)
    await expectPageHealthy(page, '/zh/s')
    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(main.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')

    // A new profile has no resume, contact details, school verification or talent-pool consent.
    for (const href of ['/zh/s/school-verify', '/zh/s/resume', '/zh/s/contact']) {
      await expect(main.locator(`a[href="${href}"]`).first()).toBeVisible()
    }
    for (const href of ['/zh/s/invitations', '/zh/s/applications']) {
      await expect(main.locator(`a[href="${href}"]`)).toBeVisible()
    }
    await expectNoSeriousA11y(page)
    await shot(page, 'student-home-zh-1440')

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/zh/s')
    await expectNoHorizontalScroll(page)
    await shot(page, 'student-home-zh-375')
  })

  test('every page has one title, passes the accessibility scan and fits 375px', async ({ page }) => {
    test.slow()
    await loginStudent(page)
    for (const [name, route] of PAGES) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await expectPageHealthy(page, `/zh${route}`)
      await expect(page.getByRole('main').getByRole('heading', { level: 1 }), route).toHaveCount(1)
      await expectNoSeriousA11y(page)
      await shot(page, `student-${name}-zh-1440`)

      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(`/zh${route}`)
      await expectNoHorizontalScroll(page)
    }
  })

  test('english pages render their own copy', async ({ page }) => {
    await loginStudent(page)
    await expectPageHealthy(page, '/en/s')
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Student Dashboard' })).toBeVisible()
    await shot(page, 'student-home-en-1440')

    await expectPageHealthy(page, '/en/s/applications')
    await expect(page.getByRole('main').getByRole('link', { name: 'Browse jobs' })).toHaveAttribute('href', '/en/jobs')
  })
})
