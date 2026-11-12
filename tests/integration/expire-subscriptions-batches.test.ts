/** T04 batch regression: no paid fixture is needed to test expiry traversal. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/server/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { setupTestDb, testDb } from '../setup/db'
import { runExpireSubscriptions } from '@/server/jobs/expire-subscriptions'

setupTestDb()
const NOW = new Date('2030-05-12T04:00:00.000Z')
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('M8-T04 expiry batch cursor', () => {
  it('expires the 51st company after the first 50 disappear from the ACTIVE candidate set', async () => {
    const plan = await testDb.plan.create({ data: {
      code: 'T04_BATCH_ONLY', kind: 'PLAN', nameZh: '合成批次套餐', nameEn: 'Synthetic batch plan',
      priceSen: 100, credits: 0, durationDays: 1, jobPostLimit: 1, seatLimit: 1, invitationQuota: 0,
    } })
    const ids = Array.from({ length: 51 }, (_, index) => 't04-batch-company-' + String(index).padStart(3, '0'))
    await testDb.company.createMany({ data: ids.map(id => ({ id, legalName: 'Synthetic expiry batch ' + id })) })
    await testDb.subscription.createMany({ data: ids.map((companyId, index) => ({
      id: 't04-batch-subscription-' + String(index).padStart(3, '0'),
      companyId, planId: plan.id, status: 'ACTIVE' as const,
      startsAt: new Date(NOW.getTime() - 2 * 86_400_000),
      endsAt: index === 50 ? NOW : new Date(NOW.getTime() - 86_400_000),
    })) })
    // These deliberately have no order: the runner only expires elapsed rows.
    expect(await testDb.company.count({ where: { subscriptions: { some: { status: 'ACTIVE' } } } })).toBe(51)
    await runExpireSubscriptions()
    const expired = await testDb.subscription.findMany({
      where: { companyId: { in: ids } }, orderBy: { companyId: 'asc' },
      select: { companyId: true, status: true, expiryReminderAt: true },
    })
    expect(expired).toEqual(ids.map(companyId => ({ companyId, status: 'EXPIRED', expiryReminderAt: null })))
    expect(await testDb.company.count({ where: { subscriptions: { some: { status: 'ACTIVE' } } } })).toBe(0)
    await runExpireSubscriptions()
    expect(await testDb.subscription.count({ where: { status: 'EXPIRED', companyId: { in: ids } } })).toBe(51)
    expect(await testDb.notification.count()).toBe(0)
    expect(await testDb.companyMember.count()).toBe(0)
    expect(await testDb.creditWallet.count()).toBe(0)
  })
})
