/**
 * M8-T01 service contract (existing Plan fields; no M8-T02 payment model):
 * admin-plans exports listPlansAdmin(ctx, {cursor?,limit?,active?}),
 * createPlan(ctx, fullInput)->{id}, updatePlan(ctx, fullInput+id+expectedUpdatedAt)->{id},
 * deletePlan(ctx, {id})->void, listPublicPlans()->{billingEnabled,items}.
 * Admin page: {items,nextCursor}; order by sortOrder,id; limit 1..100.
 * All admin services re-read ACTIVE ADMIN. Errors: ForbiddenError for access,
 * NotFoundError for missing rows; ConflictError for duplicate code, stale writes
 * and referenced deletion. FREE deletion/deactivation and code/kind mutation reject.
 * Audit actions: plan.create/update/deactivate/delete, targetType Plan.
 * All writes and their one audit row share a transaction; no arbitrary name text in metadata.
 * Full-input null is explicit unlimited for PLAN and absent entitlement for CREDIT_PACK.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plan, Prisma } from '@prisma/client'

vi.mock('@/server/db', async () => {
  const { testDb } = await import('../setup/db')
  return { db: testDb }
})
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer, createStudent, SENTINEL } from '../factories'
import {
  createPlan, updatePlan, deletePlan, listPlansAdmin, listPublicPlans,
} from '@/server/services/admin-plans'
import { updateSettingAdmin } from '@/server/services/admin-settings'
import { clearSettingsCache } from '@/server/services/settings'
import { ConflictError, ForbiddenError, NotFoundError } from '@/server/errors'

setupTestDb()
beforeEach(() => clearSettingsCache())

type PlanInput = Parameters<typeof createPlan>[1]

function input(changes: Partial<PlanInput> = {}): PlanInput {
  return {
    code: 'STANDARD_Y', kind: 'PLAN', nameZh: '年度套餐', nameEn: 'Annual plan',
    priceSen: 299900, credits: 120, durationDays: 365,
    jobPostLimit: 10, seatLimit: 3, invitationQuota: 200,
    isActive: true, isPublic: true, sortOrder: 0,
    ...changes,
  }
}

function fixture(changes: Partial<Prisma.PlanCreateInput> = {}) {
  return testDb.plan.create({
    data: { ...input(), updatedAt: new Date('2020-01-01T00:00:00.000Z'), ...changes },
  })
}

function edit(row: Plan, changes: Partial<PlanInput> = {}) {
  return {
    id: row.id, expectedUpdatedAt: row.updatedAt.toISOString(),
    code: row.code, kind: row.kind, nameZh: row.nameZh, nameEn: row.nameEn,
    priceSen: row.priceSen, credits: row.credits, durationDays: row.durationDays,
    jobPostLimit: row.jobPostLimit, seatLimit: row.seatLimit,
    invitationQuota: row.invitationQuota, isActive: row.isActive,
    isPublic: row.isPublic, sortOrder: row.sortOrder, ...changes,
  }
}

function freeFixture() {
  return fixture({
    code: 'FREE', priceSen: 0, credits: 0, durationDays: null,
    jobPostLimit: 2, seatLimit: 3, invitationQuota: 20,
  })
}

async function planAudit(id: string) {
  return testDb.auditLog.findMany({ where: { targetType: 'Plan', targetId: id } })
}

describe('Plan admin authorization', () => {
  it.each(['student', 'employer', 'suspended', 'deleted', 'missing'] as const)(
    'rejects %s for every CRUD operation without changing plans',
    async (actor) => {
      const row = await fixture()
      let userId = 'missing-user'
      if (actor === 'student') userId = (await createStudent(testDb)).userId
      if (actor === 'employer') userId = (await createEmployer(testDb)).userId
      if (actor === 'suspended' || actor === 'deleted') {
        userId = (await createAdmin(testDb)).userId
        await testDb.user.update({
          where: { id: userId }, data: { status: actor === 'suspended' ? 'SUSPENDED' : 'DELETED' },
        })
      }
      const ctx = { userId }
      await expect(listPlansAdmin(ctx, {})).rejects.toBeInstanceOf(ForbiddenError)
      await expect(createPlan(ctx, input({ code: 'OTHER_Y' }))).rejects.toBeInstanceOf(ForbiddenError)
      await expect(updatePlan(ctx, edit(row, { priceSen: 1 }))).rejects.toBeInstanceOf(ForbiddenError)
      await expect(deletePlan(ctx, { id: row.id })).rejects.toBeInstanceOf(ForbiddenError)
      expect(await testDb.plan.findMany()).toEqual([row])
      expect(await testDb.auditLog.count({ where: { targetType: 'Plan' } })).toBe(0)
    },
  )

  it('re-checks a previously authorized admin after suspension', async () => {
    const ctx = await createAdmin(testDb)
    const row = await fixture()
    expect((await listPlansAdmin(ctx, {})).items.map((p) => p.id)).toContain(row.id)
    await testDb.user.update({ where: { id: ctx.userId }, data: { status: 'SUSPENDED' } })
    await expect(updatePlan(ctx, edit(row, { priceSen: 1 }))).rejects.toBeInstanceOf(ForbiddenError)
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toEqual(row)
    expect(await planAudit(row.id)).toHaveLength(0)
  })
})

describe('Plan create/update/delete', () => {
  it('persists normalized full input and a redacted create audit', async () => {
    const ctx = await createAdmin(testDb)
    const result = await createPlan(ctx, input({
      code: ' standard_y ', nameZh: ' ' + SENTINEL.name + ' ',
      nameEn: ' ' + SENTINEL.email + ' ',
    }))
    expect(await testDb.plan.findUnique({ where: { id: result.id } })).toMatchObject(
      input({ code: 'STANDARD_Y', nameZh: SENTINEL.name, nameEn: SENTINEL.email }),
    )
    const audit = await planAudit(result.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      actorId: ctx.userId, action: 'plan.create', targetType: 'Plan', targetId: result.id,
    })
    expect(JSON.stringify(audit[0].metadata)).not.toContain(SENTINEL.name)
    expect(JSON.stringify(audit[0].metadata)).not.toContain(SENTINEL.email)
  })

  it('rejects duplicate code after normalization without a second write or audit', async () => {
    const ctx = await createAdmin(testDb)
    const row = await fixture()
    await expect(createPlan(ctx, input({ code: ' standard_y ' }))).rejects.toBeInstanceOf(ConflictError)
    expect(await testDb.plan.findMany()).toEqual([row])
    expect(await testDb.auditLog.count({ where: { targetType: 'Plan' } })).toBe(0)
  })

  it('validates raw service input before persistence', async () => {
    const ctx = await createAdmin(testDb)
    const row = await fixture()
    await expect(createPlan(ctx, input({ code: 'OTHER_Y', priceSen: -1 }))).rejects.toThrow()
    await expect(updatePlan(ctx, edit(row, { seatLimit: 0 }))).rejects.toThrow()
    expect(await testDb.plan.findMany()).toEqual([row])
    expect(await testDb.auditLog.count({ where: { targetType: 'Plan' } })).toBe(0)
  })

  it('persists a credit pack with no subscription entitlement', async () => {
    const ctx = await createAdmin(testDb)
    const terms = input({
      code: 'CREDITS_10', kind: 'CREDIT_PACK', priceSen: 29900, credits: 10,
      durationDays: null, jobPostLimit: null, seatLimit: null, invitationQuota: null,
    })
    const result = await createPlan(ctx, terms)
    expect(await testDb.plan.findUnique({ where: { id: result.id } })).toMatchObject(terms)
    expect(await planAudit(result.id)).toHaveLength(1)
  })

  it('persists explicit unlimited choices and writes one update audit', async () => {
    const ctx = await createAdmin(testDb)
    const row = await fixture()
    expect(await updatePlan(ctx, edit(row, {
      priceSen: 399900, jobPostLimit: null, seatLimit: null, invitationQuota: null,
    }))).toEqual({ id: row.id })
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toMatchObject({
      priceSen: 399900, jobPostLimit: null, seatLimit: null, invitationQuota: null,
    })
    const audit = await planAudit(row.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'plan.update', actorId: ctx.userId })
  })

  it.each([
    { code: 'RENAMED_Y' },
    { kind: 'CREDIT_PACK' as const, durationDays: null, jobPostLimit: null, seatLimit: null, invitationQuota: null },
  ])('rejects an identity change %j', async (changes) => {
    const ctx = await createAdmin(testDb)
    const row = await fixture()
    await expect(updatePlan(ctx, edit(row, changes))).rejects.toThrow()
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toEqual(row)
    expect(await planAudit(row.id)).toHaveLength(0)
  })

  it('deactivates a normal plan with exactly one deactivate audit', async () => {
    const ctx = await createAdmin(testDb)
    const row = await fixture()
    await updatePlan(ctx, edit(row, { isActive: false }))
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toMatchObject({ isActive: false })
    const audit = await planAudit(row.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'plan.deactivate', actorId: ctx.userId })
  })

  it('deletes an unreferenced plan and preserves its audit', async () => {
    const ctx = await createAdmin(testDb)
    const row = await fixture()
    await deletePlan(ctx, { id: row.id })
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toBeNull()
    const audit = await planAudit(row.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'plan.delete', actorId: ctx.userId, targetId: row.id })
  })

  it('does not turn missing update/delete into success', async () => {
    const ctx = await createAdmin(testDb)
    await expect(updatePlan(ctx, {
      ...input(), id: 'missing-plan', expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    })).rejects.toBeInstanceOf(NotFoundError)
    await expect(deletePlan(ctx, { id: 'missing-plan' })).rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.auditLog.count({ where: { targetType: 'Plan' } })).toBe(0)
  })
})

describe('FREE and historical references', () => {
  it('protects FREE from deletion and deactivation', async () => {
    const ctx = await createAdmin(testDb)
    const row = await freeFixture()
    await expect(deletePlan(ctx, { id: row.id })).rejects.toThrow()
    await expect(updatePlan(ctx, edit(row, { isActive: false }))).rejects.toThrow()
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toEqual(row)
    expect(await planAudit(row.id)).toHaveLength(0)
  })

  it.each(['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'] as const)(
    'refuses deletion when an Order in %s references the plan',
    async (status) => {
      const ctx = await createAdmin(testDb)
      const owner = await createEmployer(testDb)
      const row = await fixture()
      const order = await testDb.order.create({
        data: {
          orderNo: 'FMJ-20261109-TEST', companyId: owner.companyId,
          createdById: owner.userId, planId: row.id, kind: 'PLAN',
          amountSen: row.priceSen, status,
        },
      })
      await expect(deletePlan(ctx, { id: row.id })).rejects.toBeInstanceOf(ConflictError)
      expect(await testDb.plan.findUnique({ where: { id: row.id } })).toEqual(row)
      expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(order)
      expect(await planAudit(row.id)).toHaveLength(0)
    },
  )

  it('refuses deletion for an expired Subscription without an Order', async () => {
    const ctx = await createAdmin(testDb)
    const owner = await createEmployer(testDb)
    const row = await fixture()
    const subscription = await testDb.subscription.create({
      data: {
        companyId: owner.companyId, planId: row.id, status: 'EXPIRED',
        startsAt: new Date('2024-01-01T00:00:00.000Z'),
        endsAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    })
    await expect(deletePlan(ctx, { id: row.id })).rejects.toBeInstanceOf(ConflictError)
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toEqual(row)
    expect(await testDb.subscription.findUnique({ where: { id: subscription.id } })).toEqual(subscription)
    expect(await planAudit(row.id)).toHaveLength(0)
  })
})

describe('optimistic update concurrency', () => {
  it('rejects a stale version without overwriting the accepted edit', async () => {
    const ctx = await createAdmin(testDb)
    const row = await fixture()
    await updatePlan(ctx, edit(row, { priceSen: 399900 }))
    const accepted = await testDb.plan.findUniqueOrThrow({ where: { id: row.id } })
    expect(accepted.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime())
    await expect(updatePlan(ctx, edit(row, { priceSen: 499900 }))).rejects.toBeInstanceOf(ConflictError)
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toEqual(accepted)
    expect(await planAudit(row.id)).toHaveLength(1)
  })

  it('allows exactly one of two simultaneous edits carrying the same version', async () => {
    const ctx = await createAdmin(testDb)
    const row = await fixture()
    const prices = [399900, 499900]
    const results = await Promise.allSettled(prices.map((priceSen) => updatePlan(ctx, edit(row, { priceSen }))))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failure = results.find((r) => r.status === 'rejected')
    expect(failure?.status).toBe('rejected')
    if (failure?.status !== 'rejected') throw new Error('Expected a rejected stale writer')
    expect(failure.reason).toBeInstanceOf(ConflictError)
    const winner = results.findIndex((r) => r.status === 'fulfilled')
    expect(await testDb.plan.findUnique({ where: { id: row.id } })).toMatchObject({ priceSen: prices[winner] })
    expect(await planAudit(row.id)).toHaveLength(1)
  })
})

describe('admin list', () => {
  it('includes drafts, filters inactive rows, and pages stable sortOrder/id ties', async () => {
    const ctx = await createAdmin(testDb)
    const rows = [
      await fixture({ code: 'A', sortOrder: 2 }),
      await fixture({ code: 'B', sortOrder: 1, isPublic: false }),
      await fixture({ code: 'C', sortOrder: 1, isActive: false }),
    ]
    const expected = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    const first = await listPlansAdmin(ctx, { limit: 2 })
    expect(first.items.map((p) => p.id)).toEqual(expected.slice(0, 2).map((p) => p.id))
    expect(first.nextCursor).not.toBeNull()
    const second = await listPlansAdmin(ctx, { limit: 2, cursor: first.nextCursor! })
    expect(second.items.map((p) => p.id)).toEqual(expected.slice(2).map((p) => p.id))
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(3)
    expect((await listPlansAdmin(ctx, { active: false })).items.map((p) => p.id)).toEqual([rows[2].id])
    expect((await listPlansAdmin(ctx, { active: true })).items.map((p) => p.id).sort())
      .toEqual([rows[0].id, rows[1].id].sort())
  })
})

describe('public plans and immediate read visibility', () => {
  const publicKeys = [
    'id', 'code', 'kind', 'nameZh', 'nameEn', 'priceSen', 'credits',
    'durationDays', 'jobPostLimit', 'seatLimit', 'invitationQuota', 'sortOrder',
  ].sort()

  it.each([false, undefined])('shows only FREE when billing is %s', async (enabled) => {
    const free = await freeFixture()
    await fixture()
    if (enabled !== undefined) {
      await testDb.systemSetting.create({ data: { key: 'billing.enabled', value: enabled } })
    }
    const page = await listPublicPlans()
    expect(page.billingEnabled).toBe(false)
    expect(page.items.map((p) => p.id)).toEqual([free.id])
    expect(Object.keys(page.items[0]).sort()).toEqual(publicKeys)
  })

  it('returns only active/public non-student products with the exact public whitelist', async () => {
    const ctx = await createAdmin(testDb)
    await updateSettingAdmin(ctx, 'billing.enabled', true)
    const free = await freeFixture()
    const paid = await fixture({ sortOrder: 1 })
    const pack = await fixture({
      code: 'CREDITS_10', kind: 'CREDIT_PACK', priceSen: 29900, credits: 10,
      durationDays: null, jobPostLimit: null, seatLimit: null, invitationQuota: null, sortOrder: 1,
    })
    await fixture({ code: 'DRAFT_Y', isPublic: false })
    await fixture({ code: 'INACTIVE_Y', isActive: false })
    await fixture({ code: 'STUDENT_RESERVED', kind: 'STUDENT_VIEW_PACK' })
    const page = await listPublicPlans()
    const expected = [free, paid, pack].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    expect(page.billingEnabled).toBe(true)
    expect(page.items.map((p) => p.id)).toEqual(expected.map((p) => p.id))
    for (const row of page.items) expect(Object.keys(row).sort()).toEqual(publicKeys)
  })

  it('limits the public catalog to 100 products in stable sortOrder/id order', async () => {
    const ctx = await createAdmin(testDb)
    await updateSettingAdmin(ctx, 'billing.enabled', true)
    const rows = Array.from({ length: 105 }, (_, index) => ({
      ...input({ code: `CATALOG_${index}`, sortOrder: index % 3 }),
      id: `plan-public-${String(index).padStart(3, '0')}`,
    }))
    // Insertion order differs from both sorting keys; a tie crosses the cap.
    await testDb.plan.createMany({ data: [...rows].reverse() })
    const expected = [...rows]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .slice(0, 100)
      .map((row) => row.id)

    const first = await listPublicPlans()
    const second = await listPublicPlans()
    expect(first.billingEnabled).toBe(true)
    expect(first.items).toHaveLength(100)
    expect(first.items.map((row) => row.id)).toEqual(expected)
    expect(second.items.map((row) => row.id)).toEqual(expected)
  })

  it('reflects changed price and public visibility on the next read without cache clearing', async () => {
    const ctx = await createAdmin(testDb)
    await updateSettingAdmin(ctx, 'billing.enabled', true)
    const row = await fixture()
    expect((await listPublicPlans()).items[0]).toMatchObject({ id: row.id, priceSen: row.priceSen })
    await updatePlan(ctx, edit(row, { priceSen: 399900 }))
    expect((await listPublicPlans()).items[0]).toMatchObject({ id: row.id, priceSen: 399900 })
    const fresh = await testDb.plan.findUniqueOrThrow({ where: { id: row.id } })
    await updatePlan(ctx, edit(fresh, { isPublic: false }))
    expect((await listPublicPlans()).items).toHaveLength(0)
  })

  it('reflects admin billing-setting changes on the next read', async () => {
    const ctx = await createAdmin(testDb)
    const free = await freeFixture()
    const paid = await fixture()
    expect((await listPublicPlans()).items.map((p) => p.id)).toEqual([free.id])
    await updateSettingAdmin(ctx, 'billing.enabled', true)
    const enabled = await listPublicPlans()
    expect(enabled.billingEnabled).toBe(true)
    expect(enabled.items.map((p) => p.id)).toContain(paid.id)
    await updateSettingAdmin(ctx, 'billing.enabled', false)
    expect(await listPublicPlans()).toMatchObject({ billingEnabled: false, items: [{ id: free.id }] })
  })
})
