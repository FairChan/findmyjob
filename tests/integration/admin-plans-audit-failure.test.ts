/**
 * M8-T01 atomicity tests. Same admin-plans exports as admin-plans.test.ts.
 * The actual AuditLog INSERT succeeds before a synthetic error is raised through
 * the Prisma query extension. Both the plan mutation and audit row must roll back.
 * This detects audit written outside the mutation transaction; logAudit is real.
 * Separate file keeps fault injection out of ordinary CRUD/public-read tests.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  const db = testDb.$extends({
    query: {
      auditLog: {
        async create({ args, query }) {
          const row = await query(args)
          if (args.data.targetType === 'Plan') {
            throw new Error('synthetic plan audit failure after insert')
          }
          return row
        },
      },
    },
  })
  return { db }
})
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin } from '../factories'
import { createPlan, updatePlan, deletePlan } from '@/server/services/admin-plans'

setupTestDb()

const terms: Parameters<typeof createPlan>[1] = {
  code: 'STANDARD_Y', kind: 'PLAN', nameZh: '年度套餐', nameEn: 'Annual plan',
  priceSen: 299900, credits: 120, durationDays: 365,
  jobPostLimit: 10, seatLimit: 3, invitationQuota: 200,
  isActive: true, isPublic: true, sortOrder: 0,
}
const failure = 'synthetic plan audit failure after insert'

describe('Plan mutation and audit atomicity', () => {
  it('rolls back create and the inserted audit row', async () => {
    const ctx = await createAdmin(testDb)
    await expect(createPlan(ctx, terms)).rejects.toThrow(failure)
    expect(await testDb.plan.count({ where: { code: terms.code } })).toBe(0)
    expect(await testDb.auditLog.count({ where: { targetType: 'Plan' } })).toBe(0)
  })

  it.each([
    { name: 'update', changes: { priceSen: 399900 } },
    { name: 'deactivate', changes: { isActive: false } },
  ])('rolls back $name and the inserted audit row', async ({ changes }) => {
    const ctx = await createAdmin(testDb)
    const row = await testDb.plan.create({
      data: { ...terms, updatedAt: new Date('2020-01-01T00:00:00.000Z') },
    })
    await expect(updatePlan(ctx, {
      ...terms, ...changes, id: row.id, expectedUpdatedAt: row.updatedAt.toISOString(),
    })).rejects.toThrow(failure)
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toEqual(row)
    expect(await testDb.auditLog.count({ where: { targetType: 'Plan' } })).toBe(0)
  })

  it('rolls back delete and the inserted audit row', async () => {
    const ctx = await createAdmin(testDb)
    const row = await testDb.plan.create({ data: terms })
    await expect(deletePlan(ctx, { id: row.id })).rejects.toThrow(failure)
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toEqual(row)
    expect(await testDb.auditLog.count({ where: { targetType: 'Plan' } })).toBe(0)
  })
})
