/**
 * M4-T07 smoke tests: talent detail page unlock button.
 *
 * Pages covered:
 *   /e/talent/[id]  — talent profile detail with unlock button (M4-T07)
 *
 * Authentication: pre-created as storageState in global-setup.ts.
 * Global-setup also ensures the verified employer has a CreditWallet (balance=100)
 * and clears any existing TalentUnlock records so the unlock button is always visible.
 *
 * Tests:
 *   1. Verified employer sees the talent detail page (200, no error boundary, no console errors).
 *   2. Unlock button is visible on the detail page (student not yet unlocked).
 *   3. Clicking unlock opens the confirmation dialog.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import type { E2EFixtures } from './global-setup'

function loadFixtures(): E2EFixtures {
  const path = resolve(process.cwd(), 'tests/e2e/fixtures.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as E2EFixtures
}

const VERIFIED_STATE = resolve(process.cwd(), 'tests/e2e/auth-verified.json')

function assertNoErrors(errors: string[]) {
  const relevant = errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('net::ERR_') &&
      !e.includes('Failed to load resource'),
  )
  expect(relevant, `Unexpected console errors: ${relevant.join('; ')}`).toHaveLength(0)
}

test.describe('M4-T07 smoke: talent detail unlock button', () => {
  let fixtures: E2EFixtures

  test.beforeAll(() => {
    fixtures = loadFixtures()
  })

  test('smoke /e/talent/[id]: 200, no error boundary, no console errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto(`/zh/e/talent/${fixtures.student.profileId}`)
      expect(response?.status()).toBe(200)
      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('unlock button visible when student not yet unlocked', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      await page.goto(`/zh/e/talent/${fixtures.student.profileId}`)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      // Unlock button should be visible (global-setup clears unlocks each run)
      const unlockButton = page.locator('[data-testid="unlock-button"]')
      await expect(unlockButton).toBeVisible({ timeout: 5000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('clicking unlock button opens confirmation dialog', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      await page.goto(`/zh/e/talent/${fixtures.student.profileId}`)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      const unlockButton = page.locator('[data-testid="unlock-button"]')
      await expect(unlockButton).toBeVisible({ timeout: 5000 })
      await unlockButton.click()

      // Confirmation dialog should appear (use aria-name to avoid matching any Next.js error overlays)
      await expect(page.getByRole('dialog', { name: '解锁候选人' })).toBeVisible({ timeout: 5000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })
})
