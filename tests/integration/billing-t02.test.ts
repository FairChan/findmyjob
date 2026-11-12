/**
 * M8-T02 behavioral contract; requires the reviewed schema and billing service.
 * Real guarded test DB/transactions/credits/audit. Only object storage and the
 * post-commit notification boundary are mocked. Not executed during preparation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  getObjectBytes: vi.fn(),
  notifyOrderConfirmed: vi.fn(),
}))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('@/lib/storage', () => ({ getObjectBytes: mocks.getObjectBytes }))
vi.mock('@/server/services/notify', () => ({ notifyOrderConfirmed: mocks.notifyOrderConfirmed }))

import { setupTestDb, testDb } from '../setup/db'
import { createAdmin, createEmployer } from '../factories'
import {
  billingFixture, pendingOrder, awaitingOrder, proofUpload, foundingOffer,
  setting, PROOF_BYTES, BANK_SETTING, type BillingFixture,
} from '../helpers/billing-t02'
import {
  quoteOrder, createOrder, getMyOrder, listMyOrders,
  attachBankProof, cancelPendingOrder, confirmBankOrder,
} from '@/server/services/billing'
import { getSetting } from '@/server/services/settings'
import { lockXact, LOCK_NS } from '@/server/lib/advisory-locks'

setupTestDb()
beforeEach(() => {
  mocks.getObjectBytes.mockReset().mockResolvedValue(PROOF_BYTES)
  mocks.notifyOrderConfirmed.mockReset().mockResolvedValue(undefined)
})

function confirm(f: BillingFixture, order: { id: string; amountSen: number }) {
  return confirmBankOrder(f.adminCtx, {
    orderId: order.id, receivedAmountSen: order.amountSen, note: 'Synthetic verified bank receipt',
  })
}

async function noDelivery(orderId: string, companyId: string) {
  expect(await testDb.creditLedger.count({ where: { refType: 'Order', refId: orderId } })).toBe(0)
  expect(await testDb.subscription.count({ where: { orderId } })).toBe(0)
  expect(await testDb.auditLog.count({ where: { action: 'order.confirm', targetId: orderId } })).toBe(0)
  expect(await testDb.creditWallet.findUnique({ where: { companyId } })).toBeNull()
  expect(mocks.notifyOrderConfirmed).not.toHaveBeenCalled()
}

async function rejectWithoutOrder(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
  expect(await testDb.order.count()).toBe(0)
}

describe('M8-T02 order authority and commercial terms', () => {
  it('lets an unverified OWNER buy and freezes the server quote before later plan edits', async () => {
    const f = await billingFixture()
    const quote = await quoteOrder(f.ctx, { planId: f.plan.id })
    expect(quote).toMatchObject({
      version: 1,
      plan: { id: f.plan.id, kind: 'PLAN', sourceUpdatedAt: f.plan.updatedAt.toISOString() },
      money: { currency: 'MYR', listPriceSen: 299900, discountSen: 0, payableSen: 299900 },
      delivery: { credits: 120, subscription: { durationDays: 365, jobPostLimit: 10, seatLimit: 3, invitationQuota: 200 } },
      promotion: null,
    })
    expect(await testDb.company.findUnique({ where: { id: f.ctx.companyId } }))
      .toMatchObject({ verificationStatus: 'UNSUBMITTED' })
    const order = await awaitingOrder(f)
    expect(order).toMatchObject({
      companyId: f.ctx.companyId, createdById: f.ctx.userId, planId: f.plan.id,
      amountSen: 299900, discountSen: 0, currency: 'MYR', paymentProvider: 'BANK_TRANSFER',
      commercialSnapshot: quote,
    })
    expect((order.commercialSnapshot as { capturedAt: string }).capturedAt)
      .toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    const frozen = order.commercialSnapshot
    await testDb.plan.update({
      where: { id: f.plan.id },
      data: { priceSen: 1, credits: 999, durationDays: 7, seatLimit: 99, isActive: false, isPublic: false },
    })
    await setting('billing.enabled', false)
    const result = await confirm(f, order)
    expect(result).toMatchObject({ orderId: order.id, alreadyPaid: false })
    const paid = await testDb.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(paid.commercialSnapshot).toEqual(frozen)
    expect(paid).toMatchObject({ status: 'PAID', amountSen: 299900, confirmedById: f.adminCtx.userId })
    const ledger = await testDb.creditLedger.findMany({ where: { refType: 'Order', refId: order.id } })
    expect(ledger).toEqual([expect.objectContaining({ delta: 120, reason: 'PLAN_GRANT', balanceAfter: 120 })])
    const subscription = await testDb.subscription.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(subscription.endsAt.getTime() - subscription.startsAt.getTime()).toBe(365 * 86400_000)
    expect(mocks.notifyOrderConfirmed).toHaveBeenCalledExactlyOnceWith(f.ctx.companyId, {
      orderId: order.id, amountSen: 299900,
    })
  })

  it.each([299900, 299901])('uses net payable exactly once and floors the discount for %i sen', async (priceSen) => {
    const f = await billingFixture('PLAN', priceSen)
    await foundingOffer(f)
    const order = await awaitingOrder(f)
    const discountSen = Math.floor(priceSen / 2)
    const amountSen = priceSen - discountSen
    expect(order).toMatchObject({
      amountSen, discountSen,
      commercialSnapshot: {
        money: { currency: 'MYR', listPriceSen: priceSen, discountSen, payableSen: amountSen },
        promotion: { campaign: 'FOUNDING_FIRST_YEAR', policyVersion: 'test-v1', rateBps: 5000 },
      },
    })
    await confirm(f, order)
    expect(mocks.notifyOrderConfirmed).toHaveBeenCalledExactlyOnceWith(f.ctx.companyId, {
      orderId: order.id, amountSen,
    })
    expect(await testDb.auditLog.findMany({ where: { action: 'order.confirm', targetId: order.id } }))
      .toEqual([expect.objectContaining({ metadata: expect.objectContaining({ amountSen, discountSen }) })])
  })

  it('recalculates the accepted quote and rejects forged price, credits, or policy', async () => {
    const f = await billingFixture()
    const quote = await quoteOrder(f.ctx, { planId: f.plan.id })
    for (const { acceptedQuote, code } of [
      {
        acceptedQuote: { ...quote, money: { ...quote.money, payableSen: 1, discountSen: 299899 } },
        code: 'VALIDATION_ERROR',
      },
      {
        acceptedQuote: { ...quote, delivery: { ...quote.delivery, credits: 999999 } },
        code: 'CONFLICT',
      },
      {
        acceptedQuote: { ...quote, promotion: { campaign: 'FOUNDING_FIRST_YEAR', policyVersion: 'forged', rateBps: 5000, eligibility: 'FOUNDING_FLAG_AND_REVIEWED_ALLOWLIST' } as const },
        code: 'VALIDATION_ERROR',
      },
    ]) {
      await expect(createOrder(f.ctx, {
        planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote,
      })).rejects.toMatchObject({ code })
    }
    expect(await testDb.order.count()).toBe(0)
    expect(await testDb.creditLedger.count({ where: { wallet: { companyId: f.ctx.companyId } } })).toBe(0)
    expect(await testDb.subscription.count({ where: { companyId: f.ctx.companyId } })).toBe(0)
    expect(mocks.notifyOrderConfirmed).not.toHaveBeenCalled()
  })

  it('never takes company, monetary, provider evidence, or credit fields from extra client input', async () => {
    const f = await billingFixture()
    const other = await createEmployer(testDb)
    const acceptedQuote = await quoteOrder(f.ctx, { planId: f.plan.id })
    const input = {
      planId: f.plan.id, method: 'BANK_TRANSFER' as const, acceptedQuote,
      companyId: other.companyId, amountSen: 1, discountSen: 299899,
      credits: 999999, source: 'stripe', commercialSnapshot: { forged: true },
    }
    // Rejecting unknown keys or stripping them are both valid. They must never
    // become authority. Do not require a new strict-input product rule here.
    const result = await createOrder(f.ctx, input).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    const rejectionCode = result.ok ? null : (result.error as { code?: string }).code
    expect([null, 'VALIDATION_ERROR']).toContain(rejectionCode)
    const rows = await testDb.order.findMany()
    expect(rows).toHaveLength(result.ok ? 1 : 0)
    for (const row of rows) {
      expect(row).toMatchObject({
        companyId: f.ctx.companyId, amountSen: 299900, discountSen: 0,
        paymentProvider: 'BANK_TRANSFER', commercialSnapshot: { delivery: { credits: 120 } },
      })
    }
  })

  it('requires a new accepted quote after price or entitlement version changes', async () => {
    const f = await billingFixture()
    const acceptedQuote = await quoteOrder(f.ctx, { planId: f.plan.id })
    await testDb.plan.update({ where: { id: f.plan.id }, data: { priceSen: 300001, seatLimit: 5 } })
    await rejectWithoutOrder(createOrder(f.ctx, {
      planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote,
    }), 'CONFLICT')
    const fresh = await pendingOrder(f)
    expect(fresh).toMatchObject({ amountSen: 300001, commercialSnapshot: { delivery: { subscription: { seatLimit: 5 } } } })
  })

  it.each(['ADMIN', 'RECRUITER', 'removed', 'suspended', 'wrong-user-role', 'inactive-company'] as const)(
    'rechecks live authority rather than forged OWNER context: %s', async (change) => {
      const f = await billingFixture()
      const acceptedQuote = await quoteOrder(f.ctx, { planId: f.plan.id })
      if (change === 'ADMIN' || change === 'RECRUITER') {
        await testDb.companyMember.updateMany({ where: { userId: f.ctx.userId }, data: { role: change } })
      } else if (change === 'removed') {
        await testDb.companyMember.deleteMany({ where: { userId: f.ctx.userId } })
      } else if (change === 'suspended') {
        await testDb.user.update({ where: { id: f.ctx.userId }, data: { status: 'SUSPENDED' } })
      } else if (change === 'wrong-user-role') {
        await testDb.user.update({ where: { id: f.ctx.userId }, data: { role: 'STUDENT' } })
      } else {
        await testDb.company.update({ where: { id: f.ctx.companyId }, data: { isActive: false } })
      }
      await expect(quoteOrder(f.ctx, { planId: f.plan.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await rejectWithoutOrder(createOrder(f.ctx, {
        planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote,
      }), 'FORBIDDEN')
      await expect(listMyOrders(f.ctx, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
    },
  )

  it('revoked OWNER cannot read, cancel, or attach to an existing company order', async () => {
    const f = await billingFixture()
    const order = await pendingOrder(f)
    const proof = await proofUpload(f)
    await testDb.companyMember.deleteMany({ where: { userId: f.ctx.userId } })
    for (const action of [
      () => getMyOrder(f.ctx, { orderId: order.id }),
      () => cancelPendingOrder(f.ctx, { orderId: order.id }),
      () => attachBankProof(f.ctx, { orderId: order.id, proofKey: proof.storageKey }),
    ]) await expect(action()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(order)
  })

  it('returns NOT_FOUND for another company order and does not expose it in the list', async () => {
    const f = await billingFixture()
    const order = await pendingOrder(f)
    const other = await createEmployer(testDb)
    const ctx = { ...other, role: 'OWNER' as const }
    for (const action of [
      () => getMyOrder(ctx, { orderId: order.id }),
      () => cancelPendingOrder(ctx, { orderId: order.id }),
      () => attachBankProof(ctx, { orderId: order.id, proofKey: 'payment_proofs/' + f.ctx.companyId + '/00000000-0000-4000-8000-000000000000.png' }),
    ]) await expect(action()).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await listMyOrders(ctx, {})).toMatchObject({ items: [] })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ status: 'PENDING', proofKey: null })
  })

  it('reads the current billing flag even when the settings cache contains true', async () => {
    const f = await billingFixture()
    const acceptedQuote = await quoteOrder(f.ctx, { planId: f.plan.id })
    expect(await getSetting('billing.enabled', false)).toBe(true)
    await setting('billing.enabled', false)
    await expect(quoteOrder(f.ctx, { planId: f.plan.id })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    await rejectWithoutOrder(createOrder(f.ctx, {
      planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote,
    }), 'FEATURE_DISABLED')
  })

  it.each(['missing', 'false', 'invalid'] as const)('fails closed when billing is %s', async (value) => {
    const f = await billingFixture()
    if (value === 'missing') await testDb.systemSetting.delete({ where: { key: 'billing.enabled' } })
    else await setting('billing.enabled', value === 'false' ? false : 'true')
    await expect(quoteOrder(f.ctx, { planId: f.plan.id })).rejects.toThrow()
    expect(await testDb.order.count()).toBe(0)
  })

  it.each(['inactive', 'private', 'FREE', 'STUDENT_VIEW_PACK'] as const)(
    'rejects unavailable product %s at quote and create time', async (change) => {
      const f = await billingFixture()
      const acceptedQuote = await quoteOrder(f.ctx, { planId: f.plan.id })
      const data = change === 'inactive' ? { isActive: false }
        : change === 'private' ? { isPublic: false }
          : change === 'FREE' ? { code: 'FREE', priceSen: 0, credits: 0, durationDays: null }
            : { kind: 'STUDENT_VIEW_PACK' as const }
      await testDb.plan.update({ where: { id: f.plan.id }, data })
      await expect(quoteOrder(f.ctx, { planId: f.plan.id })).rejects.toThrow()
      await expect(createOrder(f.ctx, {
        planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote,
      })).rejects.toThrow()
      expect(await testDb.order.count()).toBe(0)
    },
  )

  it('rejects new bank orders without bank configuration but still fulfills an existing order', async () => {
    const f = await billingFixture('CREDIT_PACK')
    const order = await pendingOrder(f)
    const acceptedQuote = await quoteOrder(f.ctx, { planId: f.plan.id })
    await testDb.systemSetting.delete({ where: { key: BANK_SETTING } })
    await expect(createOrder(f.ctx, {
      planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote,
    })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' })
    await setting('billing.enabled', false)
    const proof = await proofUpload(f)
    await attachBankProof(f.ctx, { orderId: order.id, proofKey: proof.storageKey })
    await confirm(f, order)
    expect(await testDb.order.count()).toBe(1)
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ status: 'PAID' })
  })
})

describe('M8-T02 proof ownership and pending-only transitions', () => {
  it('requires a persisted upload and a bounded existing object before attachment', async () => {
    const f = await billingFixture()
    const order = await pendingOrder(f)
    const proof = await proofUpload(f)
    let lockAvailableDuringRead = false
    mocks.getObjectBytes.mockImplementationOnce(async () => {
      const [row] = await testDb.$transaction((tx) => tx.$queryRaw<Array<{ available: boolean }>>(Prisma.sql`
        SELECT pg_try_advisory_xact_lock(${LOCK_NS.CREDIT}::int, hashtext(${f.ctx.companyId})::int) AS available
      `))
      lockAvailableDuringRead = row.available
      return PROOF_BYTES
    })
    await attachBankProof(f.ctx, { orderId: order.id, proofKey: proof.storageKey })
    expect(lockAvailableDuringRead).toBe(true)
    expect(mocks.getObjectBytes).toHaveBeenCalledWith(proof.storageKey, expect.objectContaining({ maxBytes: 10 * 1024 * 1024 }))
    expect(await testDb.order.findUnique({ where: { id: order.id } }))
      .toMatchObject({ status: 'AWAITING_CONFIRMATION', proofKey: proof.storageKey, paidAt: null })
    await noDelivery(order.id, f.ctx.companyId)
    const metadata = await testDb.auditLog.findMany({ where: { targetType: 'Order', targetId: order.id }, select: { metadata: true } })
    expect(JSON.stringify(metadata)).not.toContain(proof.storageKey)
    const replacement = await proofUpload(f)
    await attachBankProof(f.ctx, { orderId: order.id, proofKey: replacement.storageKey })
    expect(await testDb.order.findUnique({ where: { id: order.id } }))
      .toMatchObject({ status: 'AWAITING_CONFIRMATION', proofKey: replacement.storageKey })
    await noDelivery(order.id, f.ctx.companyId)
  })

  it.each(['unrecorded', 'other-company', 'url', 'other-purpose', 'traversal'] as const)(
    'rejects an invalid or foreign proof: %s', async (variant) => {
      const f = await billingFixture()
      const order = await pendingOrder(f)
      const proof = await proofUpload(f)
      let proofKey = proof.storageKey
      if (variant === 'unrecorded') await testDb.paymentProofUpload.delete({ where: { id: proof.id } })
      if (variant === 'other-company') {
        const other = await createEmployer(testDb)
        await testDb.paymentProofUpload.update({ where: { id: proof.id }, data: { companyId: other.companyId } })
      }
      if (variant === 'url') proofKey = 'https://storage.example.test/' + proofKey
      if (variant === 'other-purpose') proofKey = proofKey.replace('payment_proofs/', 'verifications/')
      if (variant === 'traversal') proofKey = 'payment_proofs/' + f.ctx.companyId + '/../' + proofKey.split('/').at(-1)
      await expect(attachBankProof(f.ctx, { orderId: order.id, proofKey })).rejects.toThrow()
      expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ status: 'PENDING', proofKey: null })
      await noDelivery(order.id, f.ctx.companyId)
    },
  )

  it.each(['missing-object', 'size-mismatch', 'type-mismatch'] as const)(
    'does not attach when stored proof bytes fail validation: %s', async (variant) => {
      const f = await billingFixture()
      const order = await pendingOrder(f)
      const proof = await proofUpload(f)
      if (variant === 'missing-object') mocks.getObjectBytes.mockRejectedValueOnce(new Error('synthetic missing object'))
      if (variant === 'size-mismatch') await testDb.paymentProofUpload.update({ where: { id: proof.id }, data: { sizeBytes: PROOF_BYTES.length + 1 } })
      if (variant === 'type-mismatch') await testDb.paymentProofUpload.update({ where: { id: proof.id }, data: { mimeType: 'application/pdf' } })
      await expect(attachBankProof(f.ctx, { orderId: order.id, proofKey: proof.storageKey })).rejects.toThrow()
      expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ status: 'PENDING', proofKey: null })
      await noDelivery(order.id, f.ctx.companyId)
    },
  )

  it('allows another current OWNER of the same company to attach the recorded upload', async () => {
    const f = await billingFixture()
    const order = await pendingOrder(f)
    const proof = await proofUpload(f)
    const newOwner = await createEmployer(testDb)
    await testDb.companyMember.updateMany({ where: { userId: newOwner.userId }, data: { companyId: f.ctx.companyId } })
    await testDb.companyMember.deleteMany({ where: { userId: f.ctx.userId } })
    await attachBankProof({ userId: newOwner.userId, companyId: f.ctx.companyId, role: 'OWNER' }, {
      orderId: order.id, proofKey: proof.storageKey,
    })
    expect(await testDb.order.findUnique({ where: { id: order.id } }))
      .toMatchObject({ status: 'AWAITING_CONFIRMATION', proofKey: proof.storageKey })
  })

  it('rechecks OWNER after object IO, so revocation during the read cannot attach', async () => {
    const f = await billingFixture()
    const order = await pendingOrder(f)
    const proof = await proofUpload(f)
    mocks.getObjectBytes.mockImplementationOnce(async () => {
      await testDb.companyMember.deleteMany({ where: { userId: f.ctx.userId } })
      return PROOF_BYTES
    })
    await expect(attachBankProof(f.ctx, { orderId: order.id, proofKey: proof.storageKey }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ status: 'PENDING', proofKey: null })
  })

  it('allows OWNER cancellation only before proof submission', async () => {
    const f = await billingFixture('CREDIT_PACK')
    const pending = await pendingOrder(f)
    await cancelPendingOrder(f.ctx, { orderId: pending.id })
    expect(await testDb.order.findUnique({ where: { id: pending.id } })).toMatchObject({ status: 'CANCELLED' })
    const awaiting = await awaitingOrder(f)
    await expect(cancelPendingOrder(f.ctx, { orderId: awaiting.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await testDb.order.findUnique({ where: { id: awaiting.id } })).toMatchObject({ status: 'AWAITING_CONFIRMATION' })
  })

  it.each(['PAID', 'CANCELLED', 'REFUNDED'] as const)('cannot replace proof or cancel a %s order', async (status) => {
    const f = await billingFixture()
    const order = await awaitingOrder(f)
    await testDb.order.update({ where: { id: order.id }, data: { status } })
    const proof = await proofUpload(f)
    await expect(attachBankProof(f.ctx, { orderId: order.id, proofKey: proof.storageKey })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(cancelPendingOrder(f.ctx, { orderId: order.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ status, proofKey: order.proofKey })
  })
})

describe('M8-T02 bank settlement and concurrent delivery', () => {
  it.each(['PENDING', 'CANCELLED', 'REFUNDED'] as const)('does not settle a %s bank order', async (status) => {
    const f = await billingFixture()
    const order = await awaitingOrder(f)
    await testDb.order.update({ where: { id: order.id }, data: { status, proofKey: status === 'PENDING' ? null : order.proofKey } })
    await expect(confirm(f, order)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ status, paidAt: null })
    await noDelivery(order.id, f.ctx.companyId)
  })

  it.each(['wrong-amount', 'blank-note', 'wrong-channel', 'missing-snapshot', 'corrupt-snapshot'] as const)(
    'rejects invalid settlement evidence or contract: %s', async (variant) => {
      const f = await billingFixture()
      const order = await awaitingOrder(f)
      if (variant === 'wrong-channel') await testDb.order.update({ where: { id: order.id }, data: { paymentProvider: 'STRIPE' } })
      if (variant === 'missing-snapshot') await testDb.order.update({ where: { id: order.id }, data: { commercialSnapshot: Prisma.DbNull } })
      if (variant === 'corrupt-snapshot') await testDb.order.update({ where: { id: order.id }, data: { commercialSnapshot: { version: 999, delivery: { credits: 999999 } } } })
      await expect(confirmBankOrder(f.adminCtx, {
        orderId: order.id,
        receivedAmountSen: order.amountSen + (variant === 'wrong-amount' ? 1 : 0),
        note: variant === 'blank-note' ? ' ' : 'Synthetic receipt check',
      })).rejects.toThrow()
      expect(await testDb.order.findUnique({ where: { id: order.id } }))
        .toMatchObject({ status: 'AWAITING_CONFIRMATION', paidAt: null, confirmedById: null })
      await noDelivery(order.id, f.ctx.companyId)
    },
  )

  it.each(['wrong-role', 'suspended', 'missing'] as const)('rechecks current ADMIN for confirmation: %s', async (variant) => {
    const f = await billingFixture()
    const order = await awaitingOrder(f)
    if (variant === 'wrong-role') await testDb.user.update({ where: { id: f.adminCtx.userId }, data: { role: 'EMPLOYER' } })
    if (variant === 'suspended') await testDb.user.update({ where: { id: f.adminCtx.userId }, data: { status: 'SUSPENDED' } })
    if (variant === 'missing') await testDb.user.delete({ where: { id: f.adminCtx.userId } })
    await expect(confirm(f, order)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await noDelivery(order.id, f.ctx.companyId)
  })

  it.each(['PLAN', 'CREDIT_PACK'] as const)('concurrent and repeated %s confirmations deliver exactly once', async (kind) => {
    const f = await billingFixture(kind)
    const order = await awaitingOrder(f)
    const observedAtNotification: Array<{ status: string | undefined; ledgerCount: number }> = []
    mocks.notifyOrderConfirmed.mockImplementationOnce(async () => {
      // This read uses a separate connection; delivery must already be committed.
      const committed = await testDb.order.findUnique({ where: { id: order.id } })
      const ledgerCount = await testDb.creditLedger.count({ where: { refType: 'Order', refId: order.id } })
      observedAtNotification.push({ status: committed?.status, ledgerCount })
    })
    // Each call uses an independent interactive transaction against the real DB.
    const results = await Promise.all(Array.from({ length: 5 }, () => confirm(f, order)))
    expect(results.filter((result) => !result.alreadyPaid)).toHaveLength(1)
    expect(results.filter((result) => result.alreadyPaid)).toHaveLength(4)
    expect(observedAtNotification).toEqual([{ status: 'PAID', ledgerCount: 1 }])
    const paid = await testDb.order.findUniqueOrThrow({ where: { id: order.id } })
    const replayAdmin = await createAdmin(testDb)
    await expect(confirmBankOrder({ userId: replayAdmin.userId }, {
      orderId: order.id, receivedAmountSen: order.amountSen, note: 'Synthetic duplicate confirmation',
    })).resolves.toMatchObject({ orderId: order.id, alreadyPaid: true })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(paid)
    expect(await testDb.creditLedger.findMany({ where: { refType: 'Order', refId: order.id } }))
      .toEqual([expect.objectContaining({ delta: f.plan.credits, reason: kind === 'PLAN' ? 'PLAN_GRANT' : 'PURCHASE' })])
    expect(await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } }))
      .toMatchObject({ balance: f.plan.credits })
    expect(await testDb.subscription.count({ where: { orderId: order.id } })).toBe(kind === 'PLAN' ? 1 : 0)
    expect(await testDb.auditLog.count({ where: { action: 'order.confirm', targetId: order.id } })).toBe(1)
    expect(mocks.notifyOrderConfirmed).toHaveBeenCalledOnce()
    await expect(confirmBankOrder(f.adminCtx, {
      orderId: order.id, receivedAmountSen: order.amountSen + 1, note: 'Conflicting duplicate amount',
    })).rejects.toThrow()
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toEqual(paid)
    expect(mocks.notifyOrderConfirmed).toHaveBeenCalledOnce()
  })

  it('does not roll back a committed payment when the whole notification call rejects', async () => {
    const f = await billingFixture()
    const order = await awaitingOrder(f)
    mocks.notifyOrderConfirmed.mockRejectedValueOnce(new Error('synthetic OWNER lookup or delivery failure'))
    await expect(confirm(f, order)).resolves.toMatchObject({ alreadyPaid: false })
    expect(await testDb.order.findUnique({ where: { id: order.id } })).toMatchObject({ status: 'PAID' })
    await expect(confirm(f, order)).resolves.toMatchObject({ alreadyPaid: true })
    expect(mocks.notifyOrderConfirmed).toHaveBeenCalledOnce()
    expect(await testDb.creditLedger.count({ where: { refType: 'Order', refId: order.id } })).toBe(1)
  })

  it('reserves at most one unpaid annual order under concurrent creation', async () => {
    const f = await billingFixture()
    await foundingOffer(f)
    const acceptedQuote = await quoteOrder(f.ctx, { planId: f.plan.id })
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => createOrder(f.ctx, {
      planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote,
    })))
    const rows = await testDb.order.findMany({ where: { companyId: f.ctx.companyId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'PENDING', discountSen: 149950, amountSen: 149950 })
    const fulfilledIds = outcomes.filter((outcome) => outcome.status === 'fulfilled').map((outcome) => outcome.value.orderId)
    const rejectionCodes = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason.code)
    expect(new Set(fulfilledIds)).toEqual(new Set([rows[0].id]))
    expect(rejectionCodes).toEqual(Array(rejectionCodes.length).fill('CONFLICT'))
    await cancelPendingOrder(f.ctx, { orderId: rows[0].id })
    expect(await pendingOrder(f)).toMatchObject({ discountSen: 149950 })
  })

  it('issues unique bank order numbers during concurrent independent pack purchases', async () => {
    const f = await billingFixture('CREDIT_PACK')
    const before = Date.now()
    const rows = await Promise.all(Array.from({ length: 8 }, () => pendingOrder(f)))
    const after = Date.now()
    const klDate = (now: number) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '')
    expect(new Set(rows.map((row) => row.orderNo)).size).toBe(8)
    for (const row of rows) {
      expect(row.orderNo).toMatch(/^FMJ-\d{8}-[A-Z0-9]{4}$/)
      expect([klDate(before), klDate(after)]).toContain(row.orderNo.split('-')[1])
    }
  })

  it.each(['create', 'cancel', 'confirm'] as const)('%s waits on the shared company CREDIT transaction lock', async (operation) => {
    const f = await billingFixture()
    const order = operation === 'create' ? null
      : operation === 'cancel' ? await pendingOrder(f) : await awaitingOrder(f)
    const acceptedQuote = operation === 'create' ? await quoteOrder(f.ctx, { planId: f.plan.id }) : null
    let release!: () => void
    let ready!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const acquired = new Promise<void>((resolve) => { ready = resolve })
    const holder = testDb.$transaction(async (tx) => {
      await lockXact(tx, LOCK_NS.CREDIT, f.ctx.companyId)
      ready()
      await held
    }, { timeout: 15000 })
    // A holder failure must fail the test rather than leave it waiting forever.
    await Promise.race([acquired, holder.then(() => { throw new Error('Lock holder exited early') })])
    let result: Promise<unknown> | undefined
    try {
      result = operation === 'create'
        ? createOrder(f.ctx, { planId: f.plan.id, method: 'BANK_TRANSFER', acceptedQuote: acceptedQuote! })
        : operation === 'cancel'
          ? cancelPendingOrder(f.ctx, { orderId: order!.id })
          : confirm(f, order!)
      // Attach a rejection observer immediately; the original is still awaited below.
      void result.catch(() => undefined)
      await expect.poll(async () => {
        const [row] = await testDb.$queryRaw<Array<{ waiting: number }>>(Prisma.sql`
          SELECT count(*)::int AS waiting FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND classid = ${LOCK_NS.CREDIT}::oid AND objid = hashtext(${f.ctx.companyId})::oid
        `)
        return row.waiting
      }, { timeout: 3000, interval: 20 }).toBeGreaterThan(0)
      const observed = order ? await testDb.order.findUnique({ where: { id: order.id } }) : await testDb.order.count()
      expect(observed).toEqual(order ?? 0)
    } finally {
      release()
      await holder
      if (result) await result
    }
  })
})
