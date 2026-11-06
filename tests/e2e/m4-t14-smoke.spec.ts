/**
 * M4-T14 smoke tests: verify modified employer page routes load without errors.
 *
 * Pages covered (changed in M4-T03, T04, T05, T11):
 *   /e/talent          — talent pool search (RSC boundary fix, verified-company gate)
 *   /e/talent/[id]     — talent profile detail (concurrent-lock fix, verified-company gate)
 *   /e/folders/[id]    — folder detail (function-prop RSC fix, verified-company gate)
 *
 * Authentication is pre-created as storageState in global-setup.ts (avoids Better Auth's
 * 5-login-per-60s rate limit).
 *
 * Each test:
 *   - Reuses the verified employer session from storageState
 *   - Opens the page and waits for it to settle
 *   - Asserts no Next.js error overlay, no error boundary text, no console errors
 *
 * Requires: dev server running, docker compose services up, global-setup fixtures written.
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

test.describe('M4-T14 smoke: modified employer pages', () => {
  let fixtures: E2EFixtures

  test.beforeAll(() => {
    fixtures = loadFixtures()
  })

  test('smoke /e/talent: loads without error boundary or console errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      await page.goto('/zh/e/talent')

      // Should not redirect to error page
      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      // No Next.js error overlay
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      // No error boundary fallback
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      // Page heading visible
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('smoke /e/talent/[id]: loads without error boundary or console errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      await page.goto(`/zh/e/talent/${fixtures.student.profileId}`)

      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      // Profile page has some visible content (name, heading, or profile section)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('smoke /e/folders/[id]: loads without error boundary or console errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      await page.goto(`/zh/e/folders/${fixtures.folder.folderId}`)

      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })
})
