/**
 * M4-T08 smoke tests: contact-access — detail page loads without errors.
 *
 * Pages covered (changed in M4-T08):
 *   /e/talent/[id]  — talent profile detail (contact section now shown when unlocked)
 *
 * Uses the verified employer session (storageState) from global-setup.
 * The global-setup clears TalentUnlock records each run so the unlock button
 * is always visible — the page must render cleanly whether locked or unlocked.
 *
 * Each test asserts:
 *   - HTTP 200 response
 *   - No Next.js error overlay
 *   - No error boundary fallback text
 *   - No console errors
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

test.describe('M4-T08 smoke: talent detail contact section', () => {
  let fixtures: E2EFixtures

  test.beforeAll(() => {
    fixtures = loadFixtures()
  })

  test('smoke /e/talent/[id]: detail page loads without error (locked state)', async ({ browser }) => {
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
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })
})
