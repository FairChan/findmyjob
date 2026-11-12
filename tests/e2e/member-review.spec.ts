import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { e2eDb } from './helpers/db'

test('homepage employer CTA sends an employer without a company to onboarding', async ({ page }) => {
  const { userId } = await loginAs(page, { role: 'EMPLOYER' })
  expect(await e2eDb.companyMember.count({ where: { userId } })).toBe(0)
  await page.goto('/en')
  await page.getByRole('link', { name: 'Post Jobs Free', exact: true }).first().click()
  await expect(page).toHaveURL(/\/en\/e\/onboarding$/)
  await expect(page.getByRole('heading', { name: 'Create Company', exact: true })).toBeVisible()
})

test.describe('mobile member navigation review regressions', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test.beforeEach(async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    await page.goto('/en/s/jobs')
  })

  test('opener exposes dialog relationship and expanded state', async ({ page }) => {
    const opener = page.getByRole('button', { name: 'Open navigation', exact: true, includeHidden: true })
    await expect(opener).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(opener).toHaveAttribute('aria-expanded', 'false')
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Student navigation', exact: true })
    await expect(dialog).toBeVisible()
    await expect(opener).toHaveAttribute('aria-expanded', 'true')
    await expect(opener).toHaveAttribute('aria-controls', await dialog.getAttribute('id') as string)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toHaveAttribute('aria-expanded', 'false')
  })

  for (const dismissal of ['Escape', 'close button'] as const) {
    test(`returns focus to the keyboard opener after ${dismissal}`, async ({ page }) => {
      const opener = page.getByRole('button', { name: 'Open navigation', exact: true })
      await opener.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      if (dismissal === 'Escape') await page.keyboard.press('Escape')
      else await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(opener).toBeFocused()
    })
  }

  test('reduced motion disables panel and overlay animation and transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // The decorative overlay has no accessible role; its fixed inset covers the viewport.
    const overlay = page.locator('[data-state="open"].fixed.inset-0')
    await expect(overlay).toHaveCount(1)
    for (const element of [dialog, overlay]) {
      await expect.soft(element).toHaveCSS('animation-name', 'none')
      await expect.soft(element).toHaveCSS('transition-property', 'none')
    }
  })
})
