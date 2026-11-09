import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: vi.fn() }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: vi.fn() }))

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer } from '../factories'
import { billingFixture, pendingOrder, setting, BANK_SETTING, SYNTHETIC_BANK } from '../helpers/billing-t02'
import {
  getBankTransferDetails, getMyOrder, listMyOrders, listOrdersAdmin,
  type MyOrdersPage, type OrderSummary,
} from '@/server/services/billing'
import { clearSettingsCache, getSetting } from '@/server/services/settings'

setupTestDb()
beforeEach(() => { vi.clearAllMocks(); clearSettingsCache() })

const SUMMARY_KEYS = ['id', 'orderNo', 'kind', 'status', 'paymentProvider', 'paymentMethod',
  'amountSen', 'discountSen', 'currency', 'createdAt', 'paidAt', 'plan', 'hasProof']
const PRIVATE_REFERENCE = 'synthetic-gateway-reference-private'
const PRIVATE_METADATA = 'synthetic-nested-private-metadata'
const SAME_TIME = new Date('2026-11-01T00:00:00.000Z')

function expectSummary(value: OrderSummary, extraKeys: string[] = []) {
  expect(Object.keys(value).sort()).toEqual([...SUMMARY_KEYS, ...extraKeys].sort())
  expect(value.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*\.\d{3}Z$/)
  expect(Number.isInteger(value.amountSen)).toBe(true)
  expect(Number.isInteger(value.discountSen)).toBe(true)
  expect(Object.keys(value.plan!).sort()).toEqual(['id', 'code', 'kind', 'nameZh', 'nameEn', 'sourceUpdatedAt'].sort())
}

describe('M8-T02 query DTO boundaries', () => {
  it('whitelists employer summary/detail and admin rows, including nested snapshot fields', async () => {
    const f = await billingFixture('CREDIT_PACK')
    const order = await pendingOrder(f)
    const snapshot = order.commercialSnapshot as Prisma.JsonObject
    const proofKey = `payment_proofs/${f.ctx.companyId}/synthetic-private.png`
    await testDb.order.update({ where: { id: order.id }, data: {
      proofKey, externalRef: PRIVATE_REFERENCE, confirmedById: f.adminCtx.userId,
      commercialSnapshot: {
        ...snapshot, internal: PRIVATE_METADATA,
        plan: { ...(snapshot.plan as Prisma.JsonObject), internal: PRIVATE_METADATA },
        delivery: { ...(snapshot.delivery as Prisma.JsonObject), internal: PRIVATE_METADATA },
      },
    } })
    await testDb.plan.update({ where: { id: f.plan.id }, data: { nameEn: 'Later catalog name', isPublic: false } })
    const own = await listMyOrders(f.ctx, {})
    const detail = await getMyOrder(f.ctx, { orderId: order.id })
    const admin = await listOrdersAdmin(f.adminCtx, { status: 'ALL' })
    expect(own.items).toHaveLength(1)
    expect(admin.items).toHaveLength(1)
    expectSummary(own.items[0])
    expectSummary(detail, ['commercialSnapshot', 'bankTransfer', 'stripePayment', 'invoice'])
    expect(detail.invoice).toBeNull()
    expectSummary(admin.items[0], ['company'])
    expect(Object.keys(admin.items[0].company).sort()).toEqual(['displayName', 'id'])
    expect(Object.keys(detail.commercialSnapshot!).sort()).toEqual(['version', 'plan', 'money', 'delivery', 'promotion', 'capturedAt'].sort())
    expect(detail.plan?.nameEn).toBe(f.plan.nameEn)
    expect(detail.hasProof).toBe(true)
    expect(detail.bankTransfer).toEqual(SYNTHETIC_BANK)
    expect(detail.stripePayment).toBeNull()
    const json = JSON.stringify([own, detail, admin])
    for (const value of [PRIVATE_REFERENCE, PRIVATE_METADATA, proofKey, f.adminCtx.userId,
      'externalRef', 'proofKey', 'createdById', 'confirmedById', 'updatedAt', 'Later catalog name']) {
      expect(json).not.toContain(value)
    }
    expect(await testDb.creditLedger.count({ where: { refId: order.id } })).toBe(0)
  })

  it.each(['missing', 'mismatched'] as const)('does not reconstruct a %s commercial snapshot from the current catalog', async variant => {
    const f = await billingFixture('CREDIT_PACK')
    const order = await pendingOrder(f)
    await testDb.order.update({ where: { id: order.id }, data: variant === 'missing'
      ? { commercialSnapshot: Prisma.DbNull, paymentProvider: null }
      : { amountSen: order.amountSen + 1 } })
    const detail = await getMyOrder(f.ctx, { orderId: order.id })
    const own = await listMyOrders(f.ctx, {})
    expect(detail.commercialSnapshot).toBeNull()
    expect(detail.plan).toBeNull()
    expect(own.items[0].plan).toBeNull()
    expect(detail.paymentProvider).toBe(variant === 'missing' ? null : 'BANK_TRANSFER')
    expect(detail.bankTransfer).toEqual(variant === 'missing' ? null : SYNTHETIC_BANK)
  })
})

describe('M8-T02 pagination and admin status selection', () => {
  it('defaults admin queries to awaiting confirmation while ALL includes every status', async () => {
    const f = await billingFixture('CREDIT_PACK')
    const statuses = ['PENDING', 'AWAITING_CONFIRMATION', 'PAID', 'CANCELLED', 'REFUNDED'] as const
    for (const status of statuses) {
      const order = await pendingOrder(f)
      await testDb.order.update({ where: { id: order.id }, data: { status } })
    }
    const implicit = await listOrdersAdmin(f.adminCtx, {})
    expect(implicit.items.map(row => row.status)).toEqual(['AWAITING_CONFIRMATION'])
    const all = await listOrdersAdmin(f.adminCtx, { status: 'ALL' })
    expect(all.items.map(row => row.status).sort()).toEqual([...statuses].sort())
    expect(all.nextCursor).toBeNull()
    const cancelled = await listOrdersAdmin(f.adminCtx, { status: 'CANCELLED' })
    expect(cancelled.items.map(row => row.status)).toEqual(['CANCELLED'])
  })

  it.each(['owner', 'admin'] as const)('%s keyset pages handle equal timestamps without duplicate or missing rows', async audience => {
    const f = await billingFixture('CREDIT_PACK')
    const other = await createEmployer(testDb)
    const orders = []
    for (let i = 0; i < 6; i++) {
      const order = await pendingOrder(f)
      orders.push(await testDb.order.update({ where: { id: order.id }, data: {
        createdAt: i < 4 ? SAME_TIME : new Date(SAME_TIME.getTime() - 1_000),
        ...(i === 5 ? { companyId: other.companyId, createdById: other.userId } : {}),
      } }))
    }
    const expected = orders.filter(order => audience === 'admin' || order.companyId === f.ctx.companyId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .map(order => order.id)
    const seen: string[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    let finished = false
    for (let pageNo = 0; pageNo < 5; pageNo++) {
      const page: MyOrdersPage = audience === 'owner'
        ? await listMyOrders(f.ctx, { cursor, limit: 2 })
        : await listOrdersAdmin(f.adminCtx, { status: 'ALL', cursor, limit: 2 })
      expect(page.items.length).toBeLessThanOrEqual(2)
      seen.push(...page.items.map(item => item.id))
      if (page.nextCursor === null) { finished = true; break }
      expect(cursors.has(page.nextCursor)).toBe(false)
      cursors.add(page.nextCursor)
      cursor = page.nextCursor
    }
    expect(finished).toBe(true)
    expect(seen).toEqual(expected)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it.each([
    'not-a-json-cursor',
    Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: 'synthetic' })).toString('base64url'),
    Buffer.from(JSON.stringify({ createdAt: SAME_TIME.toISOString(), id: '' })).toString('base64url'),
  ])('rejects malformed cursors with a controlled validation error: %#', async cursor => {
    const f = await billingFixture('CREDIT_PACK')
    await expect(listMyOrders(f.ctx, { cursor })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(listOrdersAdmin(f.adminCtx, { cursor, status: 'ALL' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

describe('M8-T02 query authority and current bank configuration', () => {
  it.each(['wrong-role', 'suspended'] as const)('admin list rechecks current authority: %s', async change => {
    const f = await billingFixture('CREDIT_PACK')
    await testDb.user.update({ where: { id: f.adminCtx.userId }, data: change === 'wrong-role'
      ? { role: 'EMPLOYER' } : { status: 'SUSPENDED' } })
    await expect(listOrdersAdmin(f.adminCtx, { status: 'ALL' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('a forged OWNER context cannot read bank details after membership revocation', async () => {
    const f = await billingFixture('CREDIT_PACK')
    await testDb.companyMember.deleteMany({ where: { companyId: f.ctx.companyId, userId: f.ctx.userId } })
    await expect(getBankTransferDetails(f.ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('reads current bank details despite a warm cache and disabled new billing', async () => {
    const f = await billingFixture('CREDIT_PACK')
    const order = await pendingOrder(f)
    await getSetting(BANK_SETTING, null)
    const current = { ...SYNTHETIC_BANK, accountNumber: '0000-0099' }
    await setting(BANK_SETTING, current)
    await setting('billing.enabled', false)
    expect(await getBankTransferDetails(f.ctx)).toEqual(current)
    expect((await getMyOrder(f.ctx, { orderId: order.id })).bankTransfer).toEqual(current)
    expect((await listMyOrders(f.ctx, {})).items.map(item => item.id)).toEqual([order.id])
    await setting(BANK_SETTING, { ...current, internal: PRIVATE_METADATA })
    expect(await getBankTransferDetails(f.ctx)).toBeNull()
  })

  it.each([
    { status: 'PENDING', provider: 'BANK_TRANSFER', show: true },
    { status: 'AWAITING_CONFIRMATION', provider: 'BANK_TRANSFER', show: true },
    { status: 'PAID', provider: 'BANK_TRANSFER', show: false },
    { status: 'CANCELLED', provider: 'BANK_TRANSFER', show: false },
    { status: 'REFUNDED', provider: 'BANK_TRANSFER', show: false },
    { status: 'PENDING', provider: 'STRIPE', show: false },
  ] as const)('bank destination for $status / $provider is shown=$show', async ({ status, provider, show }) => {
    const f = await billingFixture('CREDIT_PACK')
    const order = await pendingOrder(f)
    await testDb.order.update({ where: { id: order.id }, data: { status, paymentProvider: provider } })
    expect((await getMyOrder(f.ctx, { orderId: order.id })).bankTransfer).toEqual(show ? SYNTHETIC_BANK : null)
  })
})
