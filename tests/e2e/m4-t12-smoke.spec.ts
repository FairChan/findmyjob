/**
 * M4-T12 / M4-T21 E2E: real unlock flow + notification + privacy centre.
 *
 * Flow:
 *   1. Verified employer opens the m4t12 student talent detail page and unlocks.
 *   2. Student opens /s/notifications — asserts unlock notification is there.
 *   3. Student opens /s/privacy — asserts company appears in "谁解锁了我" section.
 *
 * Authentication states are pre-created by auth.setup.ts.
 * global-setup clears any stale TalentUnlock+Notification for m4t12 student each run.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import type { E2EFixtures } from './global-setup'

const VERIFIED_STATE = resolve(process.cwd(), 'tests/e2e/auth-verified.json')
const STUDENT_STATE = resolve(process.cwd(), 'tests/e2e/auth-m4t12-student.json')

function loadFixtures(): E2EFixtures {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'tests/e2e/fixtures.json'), 'utf-8'),
  ) as E2EFixtures
}

function assertNoErrors(errors: string[]) {
  const relevant = errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('net::ERR_') &&
      !e.includes('Failed to load resource'),
  )
  expect(relevant, `Unexpected console errors: ${relevant.join('; ')}`).toHaveLength(0)
}

test.describe('M4-T12/M4-T21: unlock flow, notification, privacy centre', () => {

  test('employer unlocks m4t12 student; student sees notification and company in privacy centre', async ({ browser }) => {
    const fixtures = loadFixtures()
    const profileId = fixtures.m4t12Student.profileId

    // ---- Step 1: employer unlocks ----
    const empErrors: string[] = []
    const empCtx = await browser.newContext({ storageState: VERIFIED_STATE })
    const empPage = await empCtx.newPage()
    empPage.on('console', (msg) => {
      if (msg.type() === 'error') empErrors.push(msg.text())
    })

    try {
      const resp = await empPage.goto(`/zh/e/talent/${profileId}`)
      expect(resp?.status()).toBe(200)
      await expect(empPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })

      // Unlock button should be visible (no prior unlock)
      const unlockBtn = empPage.getByTestId('unlock-button')
      await expect(unlockBtn).toBeVisible({ timeout: 10000 })
      await unlockBtn.click()

      // Confirm dialog opens
      const dialog = empPage.locator('[role="dialog"]')
      await expect(dialog).toBeVisible({ timeout: 5000 })

      // Click confirm OK button (last button in footer = confirmOk)
      const confirmOk = dialog.getByRole('button', { name: '确认解锁' })
      await expect(confirmOk).toBeVisible({ timeout: 5000 })
      await confirmOk.click()

      // After unlock, page refreshes and shows "已解锁" badge
      await expect(empPage.getByText('已解锁')).toBeVisible({ timeout: 15000 })

      assertNoErrors(empErrors)
    } finally {
      await empCtx.close()
    }

    // ---- Step 2: student checks notifications ----
    const stuErrors: string[] = []
    const stuCtx = await browser.newContext({ storageState: STUDENT_STATE })
    const stuPage = await stuCtx.newPage()
    stuPage.on('console', (msg) => {
      if (msg.type() === 'error') stuErrors.push(msg.text())
    })

    try {
      const notifResp = await stuPage.goto('/zh/s/notifications')
      expect(notifResp?.status()).toBe(200)
      await expect(stuPage).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(stuPage.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(stuPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 })

      // Unlock notification should be present
      await expect(stuPage.getByText('企业解锁了你的联系方式')).toBeVisible({ timeout: 10000 })

      // Link to privacy centre
      const privacyLink = stuPage.getByRole('link', { name: '前往隐私中心查看详情' })
      await expect(privacyLink).toBeVisible({ timeout: 5000 })

      assertNoErrors(stuErrors)

      // ---- Step 3: student checks privacy centre ----
      const privacyResp = await stuPage.goto('/zh/s/privacy')
      expect(privacyResp?.status()).toBe(200)
      await expect(stuPage).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(stuPage.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(stuPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 })

      // "谁解锁了我" section must be visible
      const unlocksSection = stuPage.locator('[aria-labelledby="unlocks-heading"]')
      await expect(unlocksSection).toBeVisible({ timeout: 10000 })

      // Verified employer company ("E2E Verified Co Sdn Bhd") appears in unlocks section
      await expect(unlocksSection.getByText('E2E Verified Co Sdn Bhd')).toBeVisible({ timeout: 10000 })

      assertNoErrors(stuErrors)
    } finally {
      await stuCtx.close()
    }
  })

  test('smoke /s/notifications: 200, no error boundary, no console errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: STUDENT_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto('/zh/s/notifications')
      expect(response?.status()).toBe(200)
      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('smoke /s/privacy: 200, no error boundary, no console errors', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: STUDENT_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      const response = await page.goto('/zh/s/privacy')
      expect(response?.status()).toBe(200)
      await expect(page).not.toHaveURL(/\/error|\/500/, { timeout: 5000 })
      await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)
      await expect(page.getByText(/Something went wrong|发生了错误/i)).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })

  test('student nav shows "消息通知" link', async ({ browser }) => {
    const errors: string[] = []
    const ctx = await browser.newContext({ storageState: STUDENT_STATE })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    try {
      await page.goto('/zh/s/notifications')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 })

      // Student nav should include a notifications link
      const navLink = page.getByRole('link', { name: /消息通知/ })
      await expect(navLink).toBeVisible({ timeout: 5000 })

      assertNoErrors(errors)
    } finally {
      await ctx.close()
    }
  })
})
