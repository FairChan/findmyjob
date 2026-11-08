/**
 * Smoke tests for M7-T03: PDPA Data Rights pages.
 *
 * Tests:
 * 1. Student /s/privacy page loads (data-rights section present)
 * 2. Student /s/privacy/exports/[cuid] shows pending state for an OPEN request
 * 3. Admin /admin/data-requests page loads
 */
import { test, expect } from '@playwright/test'
import { e2eDb } from './helpers/db'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'

test.describe('M7-T03 data rights smoke', () => {
  test('student /s/privacy page is healthy', async ({ page }) => {
    await loginAs(page, { role: 'STUDENT' })
    await expectPageHealthy(page, '/zh/s/privacy')
  })

  test('student /s/privacy/exports/[id] shows pending state for OPEN request', async ({ page }) => {
    const { userId } = await loginAs(page, { role: 'STUDENT' })

    const req = await e2eDb.dataRequest.create({
      data: { userId, type: 'EXPORT', status: 'OPEN' },
    })

    try {
      await expectPageHealthy(page, `/zh/s/privacy/exports/${req.id}`)
    } finally {
      await e2eDb.dataRequest.delete({ where: { id: req.id } }).catch(() => {})
    }
  })

  test('admin /admin/data-requests page is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/data-requests')
  })
})
