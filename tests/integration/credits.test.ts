/**
 * Integration tests for credits service (M3-T06).
 * Tests getWalletBalance against a real DB.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/server/auth', () => ({
  getSession: vi.fn(),
  auth: {},
}))

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { getWalletBalance } from '@/server/services/credits'

setupTestDb()

describe('getWalletBalance', () => {
  it('returns null when company has no wallet', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    const balance = await getWalletBalance({ userId, companyId })
    expect(balance).toBeNull()
  })

  it('returns 0 when wallet exists with zero balance', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.creditWallet.create({ data: { companyId, balance: 0 } })
    const balance = await getWalletBalance({ userId, companyId })
    expect(balance).toBe(0)
  })

  it('returns correct balance when wallet has credits', async () => {
    const { userId, companyId } = await createEmployer(testDb)
    await testDb.creditWallet.create({ data: { companyId, balance: 150 } })
    const balance = await getWalletBalance({ userId, companyId })
    expect(balance).toBe(150)
  })

  it('returns null for a non-existent company', async () => {
    const balance = await getWalletBalance({ userId: 'no-user', companyId: 'non-existent-company-id' })
    expect(balance).toBeNull()
  })
})
