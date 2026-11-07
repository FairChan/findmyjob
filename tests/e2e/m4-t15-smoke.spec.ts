/**
 * M4-T15 smoke tests:
 *
 * 1. Invalid URL params return 200 with an "invalid params" message, not 500.
 * 2. Folders page (list + detail) for unverified company shows verification-required alert.
 * 3. Smoke checks for all pages modified in M4-T14 and M4-T15.
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
const UNVERIFIED_STATE = resolve(process.cwd(), 'tests/e2e/auth-unverified.json')

function assertNoErrors(errors: string[]) {
  const relevant = errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('net::ERR_') &&
      !e.includes('Failed to load resource'),
  )
  expect(relevant, `Unexpected console errors: ${relevant.join('; ')}`).toHaveLength(0)
}

// ---------------------------------------------------------------------------
// Invalid URL params: must render 200 with invalidParams message, not 500
// ---------------------------------------------------------------------------

test.describe('M4-T15: invalid URL params show message not 500', () => {
  // 按语言精确匹配 messages 里的 invalidParams 文案（zh 和 en 各跑一遍）
  const INVALID_TEXT = {
    zh: '请求参数无效，请检查页码或筛选条件后重试',
    en: 'Invalid request parameters. Please check the page number or filters and try again.',
  } as const
  const invalidCases = [
    { label: 'sort=x', query: 'sort=x' },
    { label: 'degreeLevel=X', query: 'degreeLevel=X' },
    { label: 'page=0', query: 'page=0' },
    { label: 'page=26 (over maxPage)', query: 'page=26' },
    { label: 'keyword over 100 chars', query: `keyword=${'a'.repeat(101)}` },
  ]

  for (const locale of ['zh', 'en'] as const) {
    for (const { label, query } of invalidCases) {
      test(`[${locale}] invalid param: ${label} — 200, no 500, shows invalidParams text`, async ({ browser }) => {
        const errors: string[] = []
        const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
        const page = await ctx.newPage()
        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(msg.text())
        })

        try {
          const response = await page.goto(`/${locale}/e/talent?${query}`)
          expect(response?.status(), `Expected 200 for ${label}`).toBe(200)
          await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
          await expect(page.getByText(INVALID_TEXT[locale])).toBeVisible({ timeout: 10000 })
          assertNoErrors(errors)
        } finally {
          await ctx.close()
        }
      })
    }
  }

  // 空的 schoolId 按「不按学校筛选」处理，不报参数错误（DECISIONS 2026-11-07 M4-T15）
  test('?schoolId= (empty) is treated as no school filter — 200, no invalidParams text', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    try {
      const response = await page.goto('/zh/e/talent?schoolId=')
      expect(response?.status()).toBe(200)
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(INVALID_TEXT.zh)).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Folders pages: unverified company sees verification-required alert
// ---------------------------------------------------------------------------

test.describe('M4-T15: folders pages require verified company', () => {
  let fixtures: E2EFixtures

  test.beforeAll(() => {
    fixtures = loadFixtures()
  })

  test('unverified employer: /e/folders shows verify-required alert, not 500', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: UNVERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto('/zh/e/folders')
      expect(response?.status()).toBe(200)
      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      const verifyAlert = page.locator('[role="alert"].border-amber-200')
      await expect(verifyAlert).toBeVisible({ timeout: 10000 })
      const onboardingLink = page.locator('a[href*="onboarding"]').first()
      await expect(onboardingLink).toBeVisible({ timeout: 5000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('unverified employer: /e/folders/[id] shows verify-required alert, not 500', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: UNVERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      // Use the fixture folder id — it was created by the verified employer, but the
      // unverified employer hits the verification gate before the folder lookup
      const response = await page.goto(`/zh/e/folders/${fixtures.folder.folderId}`)
      expect(response?.status()).toBe(200)
      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      // Either a verify-required alert or a redirect to onboarding
      const hasAlert = await page.locator('[role="alert"].border-amber-200').count()
      const isOnboarding = page.url().includes('/e/onboarding')
      expect(hasAlert > 0 || isOnboarding, 'Expected verify alert or redirect to onboarding').toBe(true)

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('verified employer: /e/folders loads without errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto('/zh/e/folders')
      expect(response?.status()).toBe(200)
      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('verified employer: /e/folders/[id] loads without errors', async ({ browser }) => {
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
})

// ---------------------------------------------------------------------------
// Smoke: all pages modified in M4-T14 and M4-T15 load without error
// ---------------------------------------------------------------------------

test.describe('M4-T15 smoke: all M4-T14+T15 modified pages', () => {
  let fixtures: E2EFixtures

  test.beforeAll(() => {
    fixtures = loadFixtures()
  })

  test('smoke /e/talent: 200, no error boundary', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    try {
      const response = await page.goto('/zh/e/talent')
      expect(response?.status()).toBe(200)
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })
      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('smoke /e/talent/[id]: 200, no error boundary', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    try {
      const response = await page.goto(`/zh/e/talent/${fixtures.student.profileId}`)
      expect(response?.status()).toBe(200)
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })
      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('smoke /e/folders: 200, no error boundary', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    try {
      const response = await page.goto('/zh/e/folders')
      expect(response?.status()).toBe(200)
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })
      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('smoke /e/folders/[id]: 200, no error boundary', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    try {
      const response = await page.goto(`/zh/e/folders/${fixtures.folder.folderId}`)
      expect(response?.status()).toBe(200)
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 10000 })
      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })
})
