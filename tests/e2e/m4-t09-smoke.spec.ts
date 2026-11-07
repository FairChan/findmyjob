/**
 * M4-T09 smoke tests: resume download watermark — talent detail page loads without errors.
 *
 * Pages covered (changed in M4-T09):
 *   /e/talent/[id]  — talent profile detail (download resume link shown when unlocked + resumeIds)
 *
 * Uses the verified employer session (storageState) from global-setup.
 * The global-setup creates an `unlockedStudent` fixture with a TalentUnlock and a resume file,
 * so the download button is always visible for this student fixture.
 *
 * Each test asserts:
 *   - HTTP 200 response
 *   - No Next.js error overlay
 *   - No error boundary fallback text
 *   - No console errors
 *   - Resume download link visible (data-testid="resume-download-0")
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

test.describe('M4-T09 smoke: talent detail resume download link', () => {
  let fixtures: E2EFixtures

  test.beforeAll(() => {
    fixtures = loadFixtures()
  })

  test('smoke /e/talent/[id]: detail page loads without error (unlocked state, download button visible)', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto(`/zh/e/talent/${fixtures.unlockedStudent.profileId}`)
      expect(response?.status()).toBe(200)

      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      // Resume download link must be visible for the unlocked student
      await expect(page.locator('[data-testid="resume-download-0"]')).toBeVisible({ timeout: 5000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })
})
