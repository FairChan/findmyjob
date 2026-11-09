import { describe, expect, it } from 'vitest'
import { setupTestDb, testDb } from '../setup/db'
import { seedPlans } from '../../prisma/seed-plans'

setupTestDb()

describe('M8-T01 placeholder plan seed', () => {
  it('creates the four documented placeholders with explicit finite or unlimited terms', async () => {
    await seedPlans(testDb)
    const plans = await testDb.plan.findMany({ orderBy: { sortOrder: 'asc' } })
    expect(plans).toHaveLength(4)
    expect(plans).toMatchObject([
      { code: 'FREE', kind: 'PLAN', priceSen: 0, credits: 0, durationDays: null,
        jobPostLimit: 2, seatLimit: 3, invitationQuota: 20 },
      { code: 'CREDITS_10', kind: 'CREDIT_PACK', priceSen: 29900, credits: 10, durationDays: null,
        jobPostLimit: null, seatLimit: null, invitationQuota: null },
      { code: 'STANDARD_Y', kind: 'PLAN', priceSen: 299900, credits: 120, durationDays: 365,
        jobPostLimit: 10, seatLimit: 3, invitationQuota: 200 },
      { code: 'PARTNER_Y', kind: 'PLAN', priceSen: 888800, credits: 400, durationDays: 365,
        jobPostLimit: null, seatLimit: 10, invitationQuota: 200 },
    ])
    expect(plans.every((plan) => plan.nameZh.trim() && plan.nameEn.trim())).toBe(true)
    expect(await testDb.systemSetting.findUnique({ where: { key: 'billing.enabled' } })).toBeNull()
    expect(await testDb.order.count()).toBe(0)
  })

  it('is idempotent and preserves operator price, visibility, entitlement and setting changes', async () => {
    await seedPlans(testDb)
    const saved = await testDb.plan.update({ where: { code: 'STANDARD_Y' }, data: {
      priceSen: 399901, credits: 87, jobPostLimit: 7, isPublic: false,
    } })
    await testDb.systemSetting.create({ data: { key: 'billing.enabled', value: false } })
    await seedPlans(testDb)
    expect(await testDb.plan.count()).toBe(4)
    expect(await testDb.plan.findUnique({ where: { code: 'STANDARD_Y' } })).toEqual(saved)
    expect(await testDb.systemSetting.findUnique({ where: { key: 'billing.enabled' } })).toMatchObject({ value: false })
    expect(await testDb.order.count()).toBe(0)
  })
})
