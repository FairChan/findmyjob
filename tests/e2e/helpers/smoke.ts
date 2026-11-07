import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Asserts that a page loads without errors.
 *
 * Checks:
 *  1. Final HTTP status is 200.
 *  2. Final URL contains expectUrl (default: path).
 *  3. No Next.js dev-mode error overlay ("Unhandled Runtime Error").
 *  4. No production error page text ("A server error occurred", "Application error").
 *  5. No Next.js default 404 page text.
 *  6. No console errors or uncaught page errors after networkidle.
 *
 * Console-error allowlist: empty — no dev-mode noise has been confirmed safe.
 */
export async function expectPageHealthy(
  page: Page,
  path: string,
  opts: { expectUrl?: string } = {},
): Promise<void> {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  // Attach listeners before navigation so nothing is missed
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => pageErrors.push(err.message))

  const res = await page.goto(path)
  expect(res?.status(), `HTTP status for ${path}`).toBe(200)

  const expectedUrl = opts.expectUrl ?? path
  await expect(page).toHaveURL(new RegExp(escapeRegex(expectedUrl)), { timeout: 10000 })

  // Next.js dev error overlay — the heading "Unhandled Runtime Error" appears in the overlay.
  // Playwright text locators pierce open shadow DOM (nextjs-portal uses an open root).
  await expect(page.getByText('Unhandled Runtime Error')).not.toBeVisible({ timeout: 3000 })

  // Production error pages: Next 16.4.5 global-error shows "A server error occurred"; a client-side
  // crash in a production build still shows "Application error: a client-side exception has occurred".
  await expect(page.getByText('A server error occurred')).not.toBeVisible()
  await expect(page.getByText('Application error')).not.toBeVisible()

  // Next.js default 404
  await expect(page.getByText('This page could not be found')).not.toBeVisible()

  // Wait for content to settle before checking async console noise
  await page.waitForLoadState('networkidle').catch(() => {
    // networkidle timeout is not a crash — the page may stream; continue
  })

  const allErrors = [...consoleErrors, ...pageErrors]
  if (allErrors.length > 0) {
    throw new Error(
      `Page ${path} has errors after load:\n  ${allErrors.slice(0, 5).join('\n  ')}`,
    )
  }
}
