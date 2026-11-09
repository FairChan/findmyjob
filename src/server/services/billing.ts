import 'server-only'
import { randomInt } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { Prisma, type Order, type OrderKind, type OrderStatus, type PaymentMethod } from '@prisma/client'
import type { CompanyCtx, UserCtx } from '../authz'
import { db } from '../db'
import { ConflictError, FeatureDisabledError, ForbiddenError, NotFoundError, ValidationError } from '../errors'
import { lockXact, LOCK_NS } from '../lib/advisory-locks'
import {
  bankTransferSettingsSchema, EMPTY_BANK_TRANSFER,
  foundingOfferSettingsSchema, DEFAULT_FOUNDING_OFFER,
} from '../lib/billing-settings'
import { detectFileType, checkPdf, MIME_TYPES } from '../lib/pdf'
import { logger } from '../lib/logger'
import { getObjectBytes } from '@/lib/storage'
import { getSetting } from './settings'
import { createPlanSchema } from './admin-plans'
import { createWallet, applyLedgerEntry } from './credits'
import { logAudit } from './audit'
import { notifyOrderConfirmed } from './notify'

const nonnegativeInt = z.number().int().min(0).max(2_147_483_647)
const positiveInt = z.number().int().min(1).max(2_147_483_647)
const idSchema = z.string().trim().min(1).max(200)
const isoDate = z.iso.datetime({ precision: 3 })
const PROOF_MAX_BYTES = 10 * 1024 * 1024
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 }
const UNPAID: OrderStatus[] = ['PENDING', 'AWAITING_CONFIRMATION']

const quoteShape = z.object({
  version: z.literal(1),
  plan: z.object({
    id: idSchema,
    code: z.string().min(1).max(64).regex(/^[A-Z0-9_]+$/),
    kind: z.enum(['PLAN', 'CREDIT_PACK']),
    nameZh: z.string().trim().min(1).max(100),
    nameEn: z.string().trim().min(1).max(100),
    sourceUpdatedAt: isoDate,
  }),
  money: z.object({
    currency: z.literal('MYR'),
    listPriceSen: positiveInt,
    discountSen: nonnegativeInt,
    payableSen: positiveInt,
  }),
  delivery: z.object({
    credits: nonnegativeInt,
    subscription: z.object({
      durationDays: positiveInt,
      jobPostLimit: nonnegativeInt.nullable(),
      seatLimit: positiveInt.nullable(),
      invitationQuota: nonnegativeInt.nullable(),
      manualBenefits: z.array(z.string().trim().min(1).max(500)).max(20),
    }).nullable(),
  }),
  promotion: z.object({
    campaign: z.literal('FOUNDING_FIRST_YEAR'),
    policyVersion: z.string().trim().min(1).max(100),
    rateBps: z.number().int().min(1).max(9999),
    eligibility: z.literal('FOUNDING_FLAG_AND_REVIEWED_ALLOWLIST'),
  }).nullable(),
})

function validateQuote(value: z.infer<typeof quoteShape>, ctx: z.RefinementCtx): void {
  const reject = (path: string[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  if (value.plan.code === 'FREE') reject(['plan', 'code'], 'FREE cannot be purchased')
  if (value.money.listPriceSen - value.money.discountSen !== value.money.payableSen) {
    reject(['money'], 'Quote amounts do not reconcile')
  }
  if (value.plan.kind === 'PLAN' && value.delivery.subscription === null) {
    reject(['delivery', 'subscription'], 'A plan requires subscription terms')
  }
  if (value.plan.kind === 'CREDIT_PACK' && (value.delivery.subscription !== null || value.delivery.credits === 0)) {
    reject(['delivery'], 'A credit pack requires credits and no subscription')
  }
  const discount = value.promotion
    ? Number(BigInt(value.money.listPriceSen) * BigInt(value.promotion.rateBps) / 10000n)
    : 0
  if (discount !== value.money.discountSen || (value.promotion && value.plan.kind !== 'PLAN')) {
    reject(['promotion'], 'Promotion does not match the commercial terms')
  }
}

export const orderQuoteSchema = quoteShape.superRefine(validateQuote)
export type OrderQuoteV1 = z.infer<typeof orderQuoteSchema>
export const commercialSnapshotSchema = quoteShape.extend({ capturedAt: isoDate }).superRefine(validateQuote)
export type CommercialSnapshotV1 = z.infer<typeof commercialSnapshotSchema>

export const quoteOrderSchema = z.object({ planId: idSchema })
export const createOrderSchema = z.object({
  planId: idSchema,
  method: z.literal('BANK_TRANSFER'),
  acceptedQuote: orderQuoteSchema,
})
export const listMyOrdersSchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})
export const getMyOrderSchema = z.object({ orderId: idSchema })
export const attachBankProofSchema = z.object({ orderId: idSchema, proofKey: z.string().min(1).max(500) })
export const cancelPendingOrderSchema = z.object({ orderId: idSchema })
export const confirmBankOrderSchema = z.object({
  orderId: idSchema,
  receivedAmountSen: positiveInt,
  note: z.string().trim().min(1).max(1000),
})
export const listOrdersAdminSchema = listMyOrdersSchema.extend({
  status: z.enum(['PENDING', 'AWAITING_CONFIRMATION', 'PAID', 'CANCELLED', 'REFUNDED', 'ALL']).optional(),
})

export type QuoteOrderInput = z.infer<typeof quoteOrderSchema>
export type CreateOrderInput = z.infer<typeof createOrderSchema>
export type ListMyOrdersInput = z.infer<typeof listMyOrdersSchema>
export type GetMyOrderInput = z.infer<typeof getMyOrderSchema>
export type AttachBankProofInput = z.infer<typeof attachBankProofSchema>
export type CancelPendingOrderInput = z.infer<typeof cancelPendingOrderSchema>
export type ConfirmBankOrderInput = z.infer<typeof confirmBankOrderSchema>
export type ListOrdersAdminInput = z.infer<typeof listOrdersAdminSchema>
export type OrderPaymentProvider = 'BANK_TRANSFER' | 'STRIPE'

export interface BankTransferDetails {
  bankName: string
  accountName: string
  accountNumber: string
  instructions: string
}

/** Whitelisted client DTO. Dates are ISO strings; money remains integer sen. */
export interface OrderSummary {
  id: string
  orderNo: string
  kind: OrderKind
  status: OrderStatus
  paymentProvider: OrderPaymentProvider | null
  paymentMethod: PaymentMethod | null
  amountSen: number
  discountSen: number
  currency: string
  createdAt: string
  paidAt: string | null
  plan: OrderQuoteV1['plan'] | null
  hasProof: boolean
}
export interface OrderDetail extends OrderSummary {
  commercialSnapshot: CommercialSnapshotV1 | null
  bankTransfer: BankTransferDetails | null
}
export interface MyOrdersPage { items: OrderSummary[]; nextCursor: string | null }
export interface AdminOrderRow extends OrderSummary { company: { id: string; displayName: string } }
export interface AdminOrdersPage { items: AdminOrderRow[]; nextCursor: string | null }
export interface CreatedOrder { orderId: string; orderNo: string }
export interface SettlementResult { orderId: string; alreadyPaid: boolean; subscriptionId: string | null }

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new ValidationError('Invalid billing input')
  return parsed.data
}

async function assertOwner(ctx: CompanyCtx, tx: Prisma.TransactionClient = db) {
  const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { role: true, status: true } })
  if (!user || user.role !== 'EMPLOYER' || user.status !== 'ACTIVE') throw new ForbiddenError()
  const member = await tx.companyMember.findUnique({
    where: { companyId_userId: { companyId: ctx.companyId, userId: ctx.userId } },
    include: { company: { select: { id: true, isActive: true, isFoundingPartner: true } } },
  })
  if (!member || member.role !== 'OWNER' || !member.company.isActive) throw new ForbiddenError()
  return member.company
}

async function assertAdmin(ctx: UserCtx, tx: Prisma.TransactionClient = db): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: ctx.userId }, select: { role: true, status: true } })
  if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') throw new ForbiddenError()
}

async function ownOrder(ctx: CompanyCtx, orderId: string, tx: Prisma.TransactionClient = db) {
  const order = await tx.order.findFirst({ where: { id: orderId, companyId: ctx.companyId } })
  if (!order) throw new NotFoundError('Order not found')
  return order
}

function snapshotOf(order: Order): CommercialSnapshotV1 | null {
  const result = commercialSnapshotSchema.safeParse(order.commercialSnapshot)
  if (!result.success) return null
  const snapshot = result.data
  if (snapshot.plan.id !== order.planId || snapshot.plan.kind !== order.kind
    || snapshot.money.payableSen !== order.amountSen || snapshot.money.discountSen !== order.discountSen
    || snapshot.money.currency !== order.currency) return null
  return snapshot
}

function requireSnapshot(order: Order): CommercialSnapshotV1 {
  const snapshot = snapshotOf(order)
  if (!snapshot) throw new ConflictError('Order commercial snapshot is unavailable')
  return snapshot
}

async function bankDetails(tx?: Prisma.TransactionClient): Promise<BankTransferDetails | null> {
  const value = await getSetting<unknown>('billing.bankTransfer', EMPTY_BANK_TRANSFER, { tx, fresh: true })
  const result = bankTransferSettingsSchema.safeParse(value)
  if (!result.success) return null
  const data = result.data
  if (!data.bankName.trim() || !data.accountName.trim() || !data.accountNumber.trim()) return null
  return { bankName: data.bankName, accountName: data.accountName, accountNumber: data.accountNumber, instructions: data.instructions }
}

/** Validated paid future/current segments only; legacy contracts need reconciliation. */
async function subscriptionTail(tx: Prisma.TransactionClient, companyId: string, planId: string, now: Date): Promise<Date> {
  const segments = await tx.subscription.findMany({
    where: { companyId, status: 'ACTIVE', endsAt: { gt: now } },
    include: { order: true },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  })
  let tail = now
  for (const segment of segments) {
    if (!segment.order || segment.order.status !== 'PAID' || !snapshotOf(segment.order)
      || segment.order.companyId !== companyId || segment.order.planId !== segment.planId
      || segment.endsAt.getTime() <= segment.startsAt.getTime()) {
      throw new ConflictError('An existing subscription requires reconciliation')
    }
    if (segment.planId !== planId) throw new ConflictError('Another plan is still active or scheduled')
    if (segment.startsAt.getTime() > tail.getTime()) {
      throw new ConflictError('An existing subscription schedule is not continuous')
    }
    if (segment.endsAt.getTime() > tail.getTime()) tail = segment.endsAt
  }
  return tail
}

function subscriptionEnd(startsAt: Date, durationDays: number): Date {
  const endsAt = new Date(startsAt.getTime() + durationDays * 86400_000)
  if (!Number.isFinite(endsAt.getTime())) throw new ConflictError('Invalid subscription end date')
  return endsAt
}

async function calculateQuote(
  tx: Prisma.TransactionClient, ctx: CompanyCtx, planId: string,
  company: { isFoundingPartner: boolean }, now: Date,
): Promise<OrderQuoteV1> {
  if (await getSetting<unknown>('billing.enabled', false, { tx, fresh: true }) !== true) {
    throw new FeatureDisabledError('New billing is disabled')
  }
  const plan = await tx.plan.findUnique({ where: { id: planId } })
  if (!plan || !plan.isActive || !plan.isPublic || plan.code === 'FREE' || plan.kind === 'STUDENT_VIEW_PACK') {
    throw new FeatureDisabledError('This product is unavailable')
  }
  if (!createPlanSchema.safeParse(plan).success) throw new ValidationError('Invalid product configuration')
  if (plan.kind === 'PLAN') {
    if (plan.durationDays === null) throw new ValidationError('Invalid product configuration')
    const tail = await subscriptionTail(tx, ctx.companyId, plan.id, now)
    // Both quote and create run this inside CREDIT using the current tail;
    // reject an unfulfillable contract before issuing payment instructions.
    subscriptionEnd(tail, plan.durationDays)
  }
  const policy = foundingOfferSettingsSchema.safeParse(
    await getSetting<unknown>('billing.foundingOffer', DEFAULT_FOUNDING_OFFER, { tx, fresh: true }),
  )
  if (!policy.success) throw new FeatureDisabledError('Promotion configuration is unavailable')
  const offer = policy.data
  let promotion: OrderQuoteV1['promotion'] = null
  if (plan.kind === 'PLAN' && offer.enabled && company.isFoundingPartner
    && offer.eligibleCompanyIds.includes(ctx.companyId) && offer.eligiblePlanCodes.includes(plan.code)
    && offer.startsAt !== null && offer.endsAt !== null
    && new Date(offer.startsAt).getTime() <= now.getTime() && now.getTime() < new Date(offer.endsAt).getTime()) {
    const consumed = await tx.order.findFirst({
      where: { companyId: ctx.companyId, kind: 'PLAN', status: { in: ['PAID', 'REFUNDED'] } },
      select: { id: true },
    })
    if (!consumed) promotion = {
      campaign: 'FOUNDING_FIRST_YEAR', policyVersion: offer.version, rateBps: offer.rateBps,
      eligibility: 'FOUNDING_FLAG_AND_REVIEWED_ALLOWLIST',
    }
  }
  const discountSen = promotion ? Number(BigInt(plan.priceSen) * BigInt(promotion.rateBps) / 10000n) : 0
  return parse(orderQuoteSchema, {
    version: 1,
    plan: {
      id: plan.id, code: plan.code, kind: plan.kind, nameZh: plan.nameZh, nameEn: plan.nameEn,
      sourceUpdatedAt: plan.updatedAt.toISOString(),
    },
    money: { currency: 'MYR', listPriceSen: plan.priceSen, discountSen, payableSen: plan.priceSen - discountSen },
    delivery: {
      credits: plan.credits,
      subscription: plan.kind === 'PLAN' ? {
        durationDays: plan.durationDays, jobPostLimit: plan.jobPostLimit, seatLimit: plan.seatLimit,
        invitationQuota: plan.invitationQuota,
        manualBenefits: plan.code === 'PARTNER_Y'
          ? ['1场企业宣讲会 / One employer talk', '首页品牌展示 / Homepage brand display']
          : [],
      } : null,
    },
    promotion,
  })
}

export async function quoteOrder(ctx: CompanyCtx, input: QuoteOrderInput): Promise<OrderQuoteV1> {
  await assertOwner(ctx)
  const { planId } = parse(quoteOrderSchema, input)
  return db.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.CREDIT, ctx.companyId)
    const company = await assertOwner(ctx, tx)
    return calculateQuote(tx, ctx, planId, company, new Date())
  }, TRANSACTION_OPTIONS)
}

function newOrderNo(now: Date): string {
  const day = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '')
  return 'FMJ-' + day + '-' + randomInt(36 ** 4).toString(36).toUpperCase().padStart(4, '0')
}

export async function createOrder(ctx: CompanyCtx, input: CreateOrderInput): Promise<CreatedOrder> {
  await assertOwner(ctx)
  const data = parse(createOrderSchema, input)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        await lockXact(tx, LOCK_NS.CREDIT, ctx.companyId)
        const company = await assertOwner(ctx, tx)
        const now = new Date()
        const quote = await calculateQuote(tx, ctx, data.planId, company, now)
        if (!isDeepStrictEqual(quote, data.acceptedQuote)) throw new ConflictError('Quote changed; request a new quote')
        if (!await bankDetails(tx)) throw new FeatureDisabledError('Bank transfer is not configured')
        if (quote.plan.kind === 'PLAN' && await tx.order.findFirst({
          where: { companyId: ctx.companyId, kind: 'PLAN', status: { in: UNPAID } },
          select: { id: true },
        })) throw new ConflictError('An unpaid annual order already exists')
        const snapshot: CommercialSnapshotV1 = { ...quote, capturedAt: now.toISOString() }
        const order = await tx.order.create({
          data: {
            orderNo: newOrderNo(now), companyId: ctx.companyId, createdById: ctx.userId,
            planId: quote.plan.id, kind: quote.plan.kind, amountSen: quote.money.payableSen,
            discountSen: quote.money.discountSen, currency: 'MYR',
            status: 'PENDING', paymentProvider: 'BANK_TRANSFER', paymentMethod: 'BANK_TRANSFER',
            commercialSnapshot: snapshot,
          },
          select: { id: true, orderNo: true },
        })
        await logAudit({
          actorId: ctx.userId, action: 'order.create', targetType: 'Order', targetId: order.id,
          metadata: { amountSen: quote.money.payableSen, discountSen: quote.money.discountSen, currency: 'MYR', kind: quote.plan.kind },
        }, tx)
        return { orderId: order.id, orderNo: order.orderNo }
      }, TRANSACTION_OPTIONS)
    } catch (error) {
      // A unique violation aborts its transaction, so collision recovery starts
      // a fresh transaction and rechecks the quote/authority under the same lock.
      const target = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.target : null
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
        && Array.isArray(target) && target.includes('orderNo'))) throw error
    }
  }
  throw new ConflictError('Unable to allocate an order number; retry')
}

const cursorSchema = z.object({ createdAt: isoDate, id: idSchema })
function cursorWhere(raw?: string): Prisma.OrderWhereInput {
  if (!raw) return {}
  let value: z.infer<typeof cursorSchema>
  try {
    value = cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
  } catch {
    throw new ValidationError('Invalid order cursor')
  }
  const createdAt = new Date(value.createdAt)
  return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: value.id } }] }
}
function nextCursor(rows: Order[], limit: number): string | null {
  const last = rows[limit - 1]
  return rows.length > limit && last
    ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url')
    : null
}
function summary(order: Order): OrderSummary {
  return {
    id: order.id, orderNo: order.orderNo, kind: order.kind, status: order.status,
    paymentProvider: order.paymentProvider, paymentMethod: order.paymentMethod,
    amountSen: order.amountSen, discountSen: order.discountSen, currency: order.currency,
    createdAt: order.createdAt.toISOString(), paidAt: order.paidAt?.toISOString() ?? null,
    plan: snapshotOf(order)?.plan ?? null, hasProof: order.proofKey !== null,
  }
}
export async function listMyOrders(ctx: CompanyCtx, input: ListMyOrdersInput): Promise<MyOrdersPage> {
  await assertOwner(ctx)
  const { cursor, limit = 25 } = parse(listMyOrdersSchema, input)
  const rows = await db.order.findMany({
    where: { companyId: ctx.companyId, ...cursorWhere(cursor) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
  })
  return { items: rows.slice(0, limit).map(summary), nextCursor: nextCursor(rows, limit) }
}
export async function getMyOrder(ctx: CompanyCtx, input: GetMyOrderInput): Promise<OrderDetail> {
  await assertOwner(ctx)
  const { orderId } = parse(getMyOrderSchema, input)
  const order = await ownOrder(ctx, orderId)
  return {
    ...summary(order), commercialSnapshot: snapshotOf(order),
    bankTransfer: order.paymentProvider === 'BANK_TRANSFER' && UNPAID.includes(order.status)
      ? await bankDetails() : null,
  }
}
export async function getBankTransferDetails(ctx: CompanyCtx): Promise<BankTransferDetails | null> {
  await assertOwner(ctx)
  return bankDetails()
}

function assertProofState(order: Order): void {
  if (order.paymentProvider !== 'BANK_TRANSFER' || !UNPAID.includes(order.status)) {
    throw new ConflictError('Order cannot accept bank proof')
  }
}
function proofExtension(key: string, companyId: string): string {
  const parts = key.split('/')
  if (parts.length !== 3 || parts[0] !== 'payment_proofs' || parts[1] !== companyId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg)$/.test(parts[2])) {
    throw new ValidationError('Invalid payment proof')
  }
  return parts[2].split('.')[1]
}
async function proofRecord(key: string, companyId: string, tx: Prisma.TransactionClient = db) {
  const row = await tx.paymentProofUpload.findUnique({ where: { storageKey: key } })
  if (!row || row.companyId !== companyId || row.sizeBytes < 1 || row.sizeBytes > PROOF_MAX_BYTES
    || !Object.values(MIME_TYPES).includes(row.mimeType)) throw new ValidationError('Invalid payment proof')
  return row
}
export async function attachBankProof(ctx: CompanyCtx, input: AttachBankProofInput): Promise<void> {
  await assertOwner(ctx)
  const { orderId, proofKey } = parse(attachBankProofSchema, input)
  const order = await ownOrder(ctx, orderId)
  assertProofState(order)
  const extension = proofExtension(proofKey, ctx.companyId)
  const record = await proofRecord(proofKey, ctx.companyId)
  let bytes: Buffer
  try {
    bytes = await getObjectBytes(proofKey, { maxBytes: PROOF_MAX_BYTES, signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new ValidationError('Payment proof is unavailable')
  }
  const type = detectFileType(bytes)
  if (bytes.length !== record.sizeBytes || bytes.length > PROOF_MAX_BYTES || !type
    || MIME_TYPES[type] !== record.mimeType || extension !== (type === 'jpeg' ? 'jpg' : type)) {
    throw new ValidationError('Payment proof does not match the uploaded file')
  }
  if (type === 'pdf' && !(await checkPdf(bytes, 50)).ok) throw new ValidationError('Invalid payment proof PDF')
  await db.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.CREDIT, ctx.companyId)
    await assertOwner(ctx, tx)
    const current = await ownOrder(ctx, orderId, tx)
    assertProofState(current)
    const persisted = await proofRecord(proofKey, ctx.companyId, tx)
    if (persisted.id !== record.id || persisted.mimeType !== record.mimeType || persisted.sizeBytes !== record.sizeBytes) {
      throw new ConflictError('Payment proof changed; retry')
    }
    const updated = await tx.order.updateMany({
      where: { id: orderId, companyId: ctx.companyId, status: current.status, proofKey: current.proofKey, updatedAt: current.updatedAt },
      data: { status: 'AWAITING_CONFIRMATION', proofKey },
    })
    if (updated.count !== 1) throw new ConflictError('Order changed; retry')
    await logAudit({
      actorId: ctx.userId, action: 'order.proof.attach', targetType: 'Order', targetId: orderId,
      metadata: { fromStatus: current.status, toStatus: 'AWAITING_CONFIRMATION', replaced: current.proofKey !== null },
    }, tx)
  }, TRANSACTION_OPTIONS)
}
export async function cancelPendingOrder(ctx: CompanyCtx, input: CancelPendingOrderInput): Promise<void> {
  await assertOwner(ctx)
  const { orderId } = parse(cancelPendingOrderSchema, input)
  await db.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.CREDIT, ctx.companyId)
    await assertOwner(ctx, tx)
    const order = await ownOrder(ctx, orderId, tx)
    if (order.paymentProvider !== 'BANK_TRANSFER' || order.status !== 'PENDING' || order.proofKey !== null) {
      throw new ConflictError('Only an unsubmitted bank order can be cancelled')
    }
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: 'PENDING', proofKey: null, updatedAt: order.updatedAt },
      data: { status: 'CANCELLED' },
    })
    if (updated.count !== 1) throw new ConflictError('Order changed; retry')
    await logAudit({
      actorId: ctx.userId, action: 'order.cancel', targetType: 'Order', targetId: order.id,
      metadata: { fromStatus: 'PENDING', toStatus: 'CANCELLED' },
    }, tx)
  }, TRANSACTION_OPTIONS)
}

type BankEvidence = { source: 'bank'; actorId: string; amountSen: number; noteLength: number }

/** Private delivery core: caller holds CREDIT, re-reads and verifies its channel.
 * T03 must add persisted Session/PI checks inside this transaction before using
 * this core; externally verified evidence alone cannot authorize settlement.
 */
async function settleOrder(
  tx: Prisma.TransactionClient, order: Order, snapshot: CommercialSnapshotV1, evidence: BankEvidence,
): Promise<SettlementResult> {
  if (order.status === 'PAID') {
    const subscription = await tx.subscription.findUnique({ where: { orderId: order.id }, select: { id: true } })
    return { orderId: order.id, alreadyPaid: true, subscriptionId: subscription?.id ?? null }
  }
  const paidAt = new Date()
  const terms = snapshot.delivery.subscription
  const startsAt = terms ? await subscriptionTail(tx, order.companyId, order.planId, paidAt) : null
  const endsAt = startsAt && terms ? subscriptionEnd(startsAt, terms.durationDays) : null
  const updated = await tx.order.updateMany({
    where: {
      id: order.id, status: 'AWAITING_CONFIRMATION', paymentProvider: 'BANK_TRANSFER',
      updatedAt: order.updatedAt, amountSen: evidence.amountSen,
    },
    data: { status: 'PAID', paidAt, confirmedById: evidence.actorId, paymentMethod: 'BANK_TRANSFER' },
  })
  if (updated.count !== 1) throw new ConflictError('Order changed; retry')
  await createWallet(tx, order.companyId)
  if (snapshot.delivery.credits > 0) await applyLedgerEntry(tx, {
    companyId: order.companyId, delta: snapshot.delivery.credits,
    reason: order.kind === 'PLAN' ? 'PLAN_GRANT' : 'PURCHASE',
    refType: 'Order', refId: order.id, actorId: evidence.actorId,
  })
  const subscription = startsAt && endsAt ? await tx.subscription.create({
    data: { companyId: order.companyId, planId: order.planId, orderId: order.id, startsAt, endsAt, status: 'ACTIVE' },
    select: { id: true },
  }) : null
  await logAudit({
    actorId: evidence.actorId, action: 'order.confirm', targetType: 'Order', targetId: order.id,
    metadata: {
      source: evidence.source, fromStatus: order.status, toStatus: 'PAID',
      amountSen: order.amountSen, discountSen: order.discountSen, currency: order.currency,
      creditsGranted: snapshot.delivery.credits, subscriptionId: subscription?.id ?? null,
      noteLength: evidence.noteLength,
    },
  }, tx)
  return { orderId: order.id, alreadyPaid: false, subscriptionId: subscription?.id ?? null }
}

export async function confirmBankOrder(ctx: UserCtx, input: ConfirmBankOrderInput): Promise<SettlementResult> {
  await assertAdmin(ctx)
  const data = parse(confirmBankOrderSchema, input)
  const located = await db.order.findUnique({ where: { id: data.orderId }, select: { companyId: true } })
  if (!located) throw new NotFoundError('Order not found')
  const settled = await db.$transaction(async (tx) => {
    await lockXact(tx, LOCK_NS.CREDIT, located.companyId)
    await assertAdmin(ctx, tx)
    const order = await tx.order.findUnique({ where: { id: data.orderId } })
    if (!order || order.companyId !== located.companyId) throw new NotFoundError('Order not found')
    if (order.paymentProvider !== 'BANK_TRANSFER' || !['AWAITING_CONFIRMATION', 'PAID'].includes(order.status)) {
      throw new ConflictError('Order is not awaiting bank confirmation')
    }
    if (data.receivedAmountSen !== order.amountSen) throw new ConflictError('Received amount does not match the order')
    const snapshot = requireSnapshot(order)
    if (!order.proofKey) throw new ConflictError('Order has no submitted payment proof')
    proofExtension(order.proofKey, order.companyId)
    await proofRecord(order.proofKey, order.companyId, tx)
    if (order.status === 'PAID' && order.paymentMethod !== 'BANK_TRANSFER') throw new ConflictError('Conflicting payment channel')
    const result = await settleOrder(tx, order, snapshot, {
      source: 'bank', actorId: ctx.userId, amountSen: data.receivedAmountSen, noteLength: data.note.length,
    })
    return { result, amountSen: order.amountSen }
  }, TRANSACTION_OPTIONS)
  if (!settled.result.alreadyPaid) {
    try {
      await notifyOrderConfirmed(located.companyId, { orderId: data.orderId, amountSen: settled.amountSen })
    } catch {
      logger.error({ orderId: data.orderId, companyId: located.companyId }, 'Order confirmation notification failed')
    }
  }
  return settled.result
}

export async function listOrdersAdmin(ctx: UserCtx, input: ListOrdersAdminInput): Promise<AdminOrdersPage> {
  await assertAdmin(ctx)
  const { cursor, limit = 25, status = 'AWAITING_CONFIRMATION' } = parse(listOrdersAdminSchema, input)
  const rows = await db.order.findMany({
    where: { ...(status === 'ALL' ? {} : { status }), ...cursorWhere(cursor) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    include: { company: { select: { id: true, legalName: true } } },
  })
  return {
    items: rows.slice(0, limit).map((row) => ({
      ...summary(row), company: { id: row.company.id, displayName: row.company.legalName },
    })),
    nextCursor: nextCursor(rows, limit),
  }
}
