/**
 * E2E smoke tests for M6-T13:
 *  - confirmation dialog appears for high-impact settings (legal.currentVersion)
 *  - cancel does not persist the change to the DB
 *  - confirm persists the change
 *  - /zh/admin/settings is still healthy after the changes
 */
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/session'
import { expectPageHealthy } from './helpers/smoke'
import { e2eDb as db } from './helpers/db'

test.describe('M6-T13 settings confirmation dialog smoke', () => {
  test('ADMIN: /zh/admin/settings is healthy', async ({ page }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/settings')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('ADMIN: confirmation dialog appears for legal.currentVersion, cancel leaves DB unchanged', async ({
    page,
  }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/settings')

    // Record current DB value (may be null if default has never been saved)
    const before = await db.systemSetting.findUnique({ where: { key: 'legal.currentVersion' } })
    const beforeValue = before ? String(before.value) : '2026-11-draft'

    const newValue = `v-t13-cancel-${Date.now()}`

    // Locate the legal.currentVersion row
    const row = page.locator('tr', { has: page.getByText('legal.currentVersion') })
    const input = row.locator('input[type="text"]')
    await input.fill(newValue)

    // Click Save — confirmation dialog should appear
    const saveBtn = row.getByRole('button', { name: /保存|Save/ })
    await saveBtn.click()

    // Dialog must be visible
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    // Click Cancel inside the dialog
    await page.getByRole('dialog').getByRole('button', { name: /取消|Cancel/ }).click()

    // Dialog must close
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 })

    // DB value must be unchanged
    const afterCancel = await db.systemSetting.findUnique({ where: { key: 'legal.currentVersion' } })
    const afterCancelValue = afterCancel ? String(afterCancel.value) : '2026-11-draft'
    expect(afterCancelValue).toBe(beforeValue)
  })

  test('ADMIN: confirmation dialog confirm persists legal.currentVersion to DB', async ({
    page,
  }) => {
    await loginAs(page, { role: 'ADMIN' })
    await expectPageHealthy(page, '/zh/admin/settings')

    const newValue = `v-t13-confirm-${Date.now()}`

    const row = page.locator('tr', { has: page.getByText('legal.currentVersion') })
    const input = row.locator('input[type="text"]')
    await input.fill(newValue)

    const saveBtn = row.getByRole('button', { name: /保存|Save/ })
    await saveBtn.click()

    // Dialog must be visible
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    // Click Confirm inside the dialog
    await page.getByRole('dialog').getByRole('button', { name: /确认|Confirm/ }).click()

    // Success feedback must appear
    await expect(row.getByText(/已保存|Saved/)).toBeVisible({ timeout: 10000 })

    // DB value must now equal newValue
    const afterConfirm = await db.systemSetting.findUnique({ where: { key: 'legal.currentVersion' } })
    expect(String(afterConfirm?.value)).toBe(newValue)
  })
})
