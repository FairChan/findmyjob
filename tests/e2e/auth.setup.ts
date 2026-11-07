/**
 * Playwright auth setup: logs in as the two E2E employer accounts and saves
 * browser storageState (cookies) so main tests can skip login entirely.
 *
 * Better Auth rate-limits /sign-in/email to 5 per 60 seconds.  Saving state
 * here and reusing it in every test means we only incur 2 logins total.
 *
 * Runs as a "setup" project (see playwright.config.ts) before the chromium tests.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test as setup, expect } from '@playwright/test'
import { stubTurnstile } from './helpers/turnstile'
import type { E2EFixtures } from './global-setup'

// Initial Next.js dev-mode compilation can exceed the default 30 s timeout.
setup.setTimeout(120_000)

function loadFixtures(): E2EFixtures {
  const path = resolve(process.cwd(), 'tests/e2e/fixtures.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as E2EFixtures
}

export const VERIFIED_STATE_PATH = 'tests/e2e/auth-verified.json'
export const UNVERIFIED_STATE_PATH = 'tests/e2e/auth-unverified.json'
export const M4T12_STUDENT_STATE_PATH = 'tests/e2e/auth-m4t12-student.json'

setup('authenticate as verified employer', async ({ page }) => {
  const fixtures = loadFixtures()
  await stubTurnstile(page)
  await page.goto('/zh/login')
  await page.fill('input[type="email"]', fixtures.verifiedEmployer.email)
  await page.fill('input[type="password"]', fixtures.verifiedEmployer.password)
  await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 15000 })
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 90000 })
  // Verify we're authenticated
  await expect(page).not.toHaveURL(/\/login/)
  await page.context().storageState({ path: VERIFIED_STATE_PATH })
})

setup('authenticate as unverified employer', async ({ page }) => {
  const fixtures = loadFixtures()
  await stubTurnstile(page)
  await page.goto('/zh/login')
  await page.fill('input[type="email"]', fixtures.unverifiedEmployer.email)
  await page.fill('input[type="password"]', fixtures.unverifiedEmployer.password)
  await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 15000 })
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 90000 })
  await expect(page).not.toHaveURL(/\/login/)
  await page.context().storageState({ path: UNVERIFIED_STATE_PATH })
})

setup('authenticate as m4t12 student', async ({ page }) => {
  const fixtures = loadFixtures()
  await stubTurnstile(page)
  await page.goto('/zh/login')
  await page.fill('input[type="email"]', fixtures.m4t12Student.email)
  await page.fill('input[type="password"]', fixtures.m4t12Student.password)
  await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 15000 })
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 90000 })
  await expect(page).not.toHaveURL(/\/login/)
  await page.context().storageState({ path: M4T12_STUDENT_STATE_PATH })
})
