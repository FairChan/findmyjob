/**
 * PRD §6「系统告警（对账不一致等）→ 运营：站内」。
 * notify-prd6.test.ts mocks alert() itself, so this file exercises the real alert():
 * it must write one system.alert notification per ACTIVE admin, carrying the alert code.
 */
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin } from '../factories'
import { alert } from '@/server/lib/alert'

setupTestDb()

describe('PRD §6 — system alert reaches ops in-app', () => {
  it('alert() writes a system.alert notification with the code to every ACTIVE admin', async () => {
    const a1 = await createAdmin(testDb)
    const a2 = await createAdmin(testDb)
    const suspended = await createAdmin(testDb)
    await testDb.user.update({ where: { id: suspended.userId }, data: { status: 'SUSPENDED' } })

    alert('wallet.reconcile.mismatch', { companyId: 'company-internal-id' })

    // notifyAdmins runs fire-and-forget after alert() returns.
    await expect
      .poll(async () => (await testDb.notification.findMany({ where: { type: 'system.alert' } })).length, { timeout: 10_000 })
      .toBe(2)
    const rows = await testDb.notification.findMany({ where: { type: 'system.alert' } })
    expect(rows.map((r) => r.userId).sort()).toEqual([a1.userId, a2.userId].sort())
    for (const r of rows) {
      expect(r.payload).toMatchObject({ code: 'wallet.reconcile.mismatch', companyId: 'company-internal-id' })
    }
  })
})
