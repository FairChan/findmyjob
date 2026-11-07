/**
 * M4-T18 smoke tests: pages backed by services updated to use canSeeIdentity/canSeeIdentityMany.
 *
 * Pages covered (backed by services changed in M4-T18):
 *   /e/talent          — talent pool search (talent-search.ts now uses canSeeIdentityMany)
 *   /e/talent/[id]     — talent profile detail (talent-view.ts now uses canSeeIdentity)
 *   /e/folders/[id]    — folder detail (talent-folders.ts now uses canSeeIdentityMany)
 *
 * Each test:
 *   - Opens the page as the verified employer
 *   - Asserts HTTP 200 response
 *   - Asserts no Next.js error overlay, no error boundary text, no console errors
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

test.describe('M4-T18 smoke: pages backed by identity-gate services', () => {
  let fixtures: E2EFixtures

  test.beforeAll(() => {
    fixtures = loadFixtures()
  })

  test('smoke /e/talent: loads with status 200, no errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto('/zh/e/talent')
      expect(response?.status()).toBe(200)

      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('smoke /e/talent/[id]: loads with status 200, no errors (locked state)', async ({ browser }) => {
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

  test('smoke /e/folders/[id]: loads with status 200, no errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto(`/zh/e/folders/${fixtures.folder.folderId}`)
      expect(response?.status()).toBe(200)

      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('smoke /e/talent/[id] unlocked: contact info visible', async ({ browser }) => {
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
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      // Contact section heading and phone must be visible for the unlocked student
      await expect(page.getByText(/联系方式|Contact Details/i)).toBeVisible({ timeout: 5000 })
      await expect(page.getByText(fixtures.unlockedStudent.phone)).toBeVisible({ timeout: 5000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })
})
