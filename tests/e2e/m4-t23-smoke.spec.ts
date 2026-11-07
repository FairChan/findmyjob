/**
 * M4-T23 smoke: resume download still works after sanitizePdf strict-whitelist update.
 *
 * Routes exercised (via sanitizePdf):
 *   /api/resumes/[id]/download — returns sanitized + watermarked PDF
 *
 * Verifies that the strict-whitelist change does not break the download pipeline.
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

test.describe('M4-T23 smoke: resume download after sanitize strict whitelist', () => {
  let fixtures: E2EFixtures

  test.beforeAll(() => {
    fixtures = loadFixtures()
  })

  test('smoke /api/resumes/[id]/download: returns valid PDF with strict-whitelist sanitize (M4-T23)', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: VERIFIED_STATE })

    try {
      const downloadUrl = `/api/resumes/${fixtures.unlockedStudent.resumeId}/download`
      const response = await ctx.request.get(downloadUrl, { timeout: 60_000 })

      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toBe('application/pdf')
      expect(response.headers()['cache-control'] ?? '').toContain('no-store')

      const bodyBuf = await response.body()
      expect(bodyBuf.length).toBeGreaterThan(0)
      // PDF magic bytes confirm sanitize+watermark pipeline produced a valid PDF
      expect(bodyBuf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    } finally {
      await ctx.close()
    }
  })
})
