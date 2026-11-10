/**
 * Changes requested in the 2026-11-11 prompt document: provider buttons kept but disabled on
 * the auth card, onboarding on the stepper, the partner company showcase with its detail
 * dialog, the footer watermark and the oversized nav logo.
 *
 * Set REDESIGN_SHOT_DIR to also write screenshots there.
 */
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAs } from './helpers/session'
import { stubTurnstile } from './helpers/turnstile'
import { e2eDb } from './helpers/db'

const shotDir = process.env.REDESIGN_SHOT_DIR

async function shot(page: Page, name: string, fullPage = true) {
  if (!shotDir) return
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage })
}

async function expectNoSeriousA11y(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const serious = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
}

test.describe('prompt document: auth card', () => {
  test('provider buttons are shown but not usable yet; the email form is', async ({ page }) => {
    await stubTurnstile(page)
    await page.goto('/zh/login')
    for (const name of [/使用 Google 账号继续/, /使用 Microsoft 账号继续/]) {
      const button = page.getByRole('button', { name })
      await expect(button).toBeDisabled()
      await expect(button).toContainText('即将开放')
    }
    await expect(page.getByRole('heading', { level: 1, name: '登录' })).toBeVisible()
    await expect(page.locator('[name="email"]')).toBeEditable()
    await expectNoSeriousA11y(page)
    await shot(page, 'doc-login-zh-1440')

    await page.goto('/en/register/student')
    await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeDisabled()
    await expect(page.locator('[name="email"]')).toBeEditable()
    await shot(page, 'doc-register-student-en-1440')

    // Recovery steps use the same card without provider buttons.
    await page.goto('/zh/forgot-password')
    await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('prompt document: onboarding stepper', () => {
  test('new student sees four numbered steps and moves forward by saving', async ({ page }) => {
    const { userId } = await loginAs(page, { role: 'STUDENT' })
    await e2eDb.studentProfile.create({
      data: { userId, fullName: 'Stepper Student', completeness: 10, visibility: 'HIDDEN', onboardingStep: 1 },
    })
    await page.goto('/zh/s/onboarding')
    const stepper = page.locator('.stepper')
    await expect(stepper).toBeVisible()
    await expect(stepper.locator('.stepper__segment')).toHaveCount(4)
    await expect(page.getByText('第 1 / 4 步')).toBeVisible()
    // Indicators only show progress; steps change through the save buttons.
    await expect(stepper.locator('.stepper__segment button:not([disabled])')).toHaveCount(0)
    await expectNoSeriousA11y(page)
    await shot(page, 'doc-onboarding-zh-1440')

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/zh/s/onboarding')
    await expect(stepper).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await shot(page, 'doc-onboarding-zh-375')
  })
})

test.describe('prompt document: companies and chrome', () => {
  test('showcase opens the selected company in a dialog', async ({ page }) => {
    await page.goto('/zh/companies')
    const showcase = page.getByTestId('company-showcase')
    await expect(showcase).toBeVisible()
    const carousel = showcase.getByRole('region', { name: '合作企业展示' })
    await expect(carousel).toBeVisible()
    await page.waitForTimeout(2500)
    await shot(page, 'doc-companies-zh-1440')

    await carousel.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading')).not.toBeEmpty()
    await expect(dialog).toContainText('个在招职位')
    await expect(dialog.getByRole('link', { name: '查看企业主页' })).toHaveAttribute('href', /^\/zh\/companies\/[a-z0-9]+$/)
    await shot(page, 'doc-company-dialog-zh-1440', false)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // The plain list below stays available without the canvas.
    await expect(page.locator('main a[href^="/zh/companies/"]').first()).toBeVisible()
  })

  test('nav logo breaks out of the bar and the footer carries the watermark', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/zh/jobs')
    const bar = page.locator('header').locator('div').first()
    const logo = page.locator('header img').first()
    const barBox = (await bar.boundingBox())!
    const logoBox = (await logo.boundingBox())!
    expect(logoBox.height).toBeGreaterThan(barBox.height)
    expect(logoBox.y).toBeGreaterThanOrEqual(0)
    await expect(page.locator('header a[aria-label="FindMYJob"] .text-my-flag')).toHaveCSS('font-style', 'italic')

    const watermark = page.locator('footer img[aria-hidden="true"]').first()
    await expect(watermark).toHaveAttribute('alt', '')
    await expect(page.locator('footer').getByRole('link')).toHaveCount(6)
    await page.locator('footer').scrollIntoViewIfNeeded()
    await shot(page, 'doc-footer-zh-1280', false)
  })
})
