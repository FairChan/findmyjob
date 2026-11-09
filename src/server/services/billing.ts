import 'server-only'
import { randomInt } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { env } from '@/env'
import { Prisma, type Order, type OrderKind, type OrderStatus, type PaymentMethod, type StripeCheckoutAttempt } from '@prisma/client'
import type { CompanyCtx, UserCtx } from '../authz'
import { db } from '../db'
import { AppError, ConflictError, FeatureDisabledError, ForbiddenError, NotFoundError, ValidationError } from '../errors'
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
import type {
  CheckoutObservation, FpxReceipt, FpxReceiptSnapshotV1, PaymentObservation, StripePaymentView,
} from '../payments/types'

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
  method: z.enum(['BANK_TRANSFER', 'STRIPE']),
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
  stripePayment: StripePaymentView | null
  invoice: null | { id: string; invoiceNo: string; issuedAt: string; pdfStatus: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' }
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

const stripeAttemptSnapshotSchema = z.object({
  version: z.literal(1), locale: z.enum(['zh', 'en']), mode: z.enum(['test', 'live']),
  request: z.object({
    orderId: idSchema, companyId: idSchema, amountSen: positiveInt, currency: z.literal('MYR'),
    productName: z.string().min(1).max(100),
    successUrl: z.string().url().max(2000), cancelUrl: z.string().url().max(2000),
    idempotencyKey: z.string().min(1).max(255),
  }).strict(),
}).strict()

/** Internal services only: validate immutable payment facts after taking CREDIT. */
export function readStripeAttemptSnapshot(order: Order, attempt: StripeCheckoutAttempt, mode: 'test' | 'live') {
  const rejected = () => new AppError('Stored payment facts rejected', 'PAYMENT_REJECTED', 400)
  const commercial = snapshotOf(order)
  const result = stripeAttemptSnapshotSchema.safeParse(attempt.requestSnapshot)
  if (!commercial || !result.success || order.paymentProvider !== 'STRIPE'
    || attempt.orderId !== order.id || result.data.mode !== mode) throw rejected()
  const frozen = result.data
  const request = frozen.request
  if (request.orderId !== order.id || request.companyId !== order.companyId
    || request.amountSen !== order.amountSen || request.currency !== order.currency
    || request.idempotencyKey !== attempt.idempotencyKey
    || request.productName !== (frozen.locale === 'zh' ? commercial.plan.nameZh : commercial.plan.nameEn)) throw rejected()
  const success = new URL(request.successUrl)
  const cancel = new URL(request.cancelUrl)
  const pathname = '/' + frozen.locale + '/e/billing/' + encodeURIComponent(order.id)
  for (const [url, state] of [[success, 'success'], [cancel, 'cancel']] as const) {
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash
      || url.pathname !== pathname || url.search !== '?checkout=' + state) throw rejected()
  }
  if (success.origin !== cancel.origin) throw rejected()
  if (attempt.sessionId !== order.externalRef) throw rejected()
  return frozen
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
        if (data.method === 'BANK_TRANSFER' && !await bankDetails(tx)) {
          throw new FeatureDisabledError('Bank transfer is not configured')
        }
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
            status: 'PENDING', paymentProvider: data.method,
            paymentMethod: data.method === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : null,
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
const receiptText = z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/u)
  .refine(value => value.trim().length > 0)
const fpxReceiptSchema = z.object({
  version: z.literal(1), createdAt: isoDate, amountSen: positiveInt, currency: z.literal('MYR'),
  orderNo: idSchema, sellerOrderNo: receiptText.nullable(), transactionId: receiptText.nullable(),
  bankCode: receiptText, status: z.literal('succeeded'),
})
const FPX_BANK_NAMES: Readonly<Record<string, string>> = {
  affin_bank: 'Affin Bank', agrobank: 'Agrobank', alliance_bank: 'Alliance Bank', ambank: 'AmBank',
  bank_islam: 'Bank Islam', bank_muamalat: 'Bank Muamalat', bank_of_china: 'Bank of China',
  bank_rakyat: 'Bank Rakyat', bnp_paribas: 'BNP Paribas', bsn: 'BSN', cimb: 'CIMB Bank',
  citibank: 'Citibank', deutsche_bank: 'Deutsche Bank', hong_leong_bank: 'Hong Leong Bank',
  hsbc: 'HSBC Bank', kfh: 'Kuwait Finance House', maybank2e: 'Maybank2E', maybank2u: 'Maybank2U',
  mbsb_bank: 'MBSB Bank', ocbc: 'OCBC Bank', pb_enterprise: 'Public Bank (PB enterprise)',
  public_bank: 'Public Bank', rhb: 'RHB Bank', standard_chartered: 'Standard Chartered Bank', uob: 'UOB Bank',
}
function validFpxReceipt(value: unknown, order: Order): FpxReceiptSnapshotV1 | null {
  const parsed = fpxReceiptSchema.safeParse(value)
  if (!parsed.success || parsed.data.orderNo !== order.orderNo || parsed.data.amountSen !== order.amountSen
    || parsed.data.currency !== order.currency || !Number.isFinite(new Date(parsed.data.createdAt).getTime())) return null
  return parsed.data
}
function readFpxReceipt(
  order: Order, attempt: Pick<StripeCheckoutAttempt, 'id' | 'state' | 'fpxReceipt'> | null,
): FpxReceipt | null {
  if (order.status !== 'PAID' || order.paymentProvider !== 'STRIPE' || order.paymentMethod !== 'FPX'
    || !attempt || attempt.state !== 'SUCCEEDED' || attempt.fpxReceipt === null) return null
  const receipt = validFpxReceipt(attempt.fpxReceipt, order)
  if (!receipt) {
    logger.error({ orderId: order.id, attemptId: attempt.id }, 'Stored payment receipt rejected')
    return null
  }
  return {
    createdAt: receipt.createdAt, amountSen: receipt.amountSen, currency: receipt.currency,
    orderNo: receipt.orderNo, sellerOrderNo: receipt.sellerOrderNo, transactionId: receipt.transactionId,
    bankName: Object.hasOwn(FPX_BANK_NAMES, receipt.bankCode) ? FPX_BANK_NAMES[receipt.bankCode] : null,
    status: receipt.status,
  }
}
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
  const invoice = await db.invoice.findUnique({
    where: { orderId }, select: { id: true, invoiceNo: true, issuedAt: true, pdfStatus: true },
  })
  const attempt = order.paymentProvider === 'STRIPE'
    ? await db.stripeCheckoutAttempt.findUnique({ where: { orderId }, select: { id: true, state: true, fpxReceipt: true } })
    : null
  return {
    ...summary(order), commercialSnapshot: snapshotOf(order),
    invoice: invoice ? { ...invoice, issuedAt: invoice.issuedAt.toISOString() } : null,
    stripePayment: order.paymentProvider === 'STRIPE'
      ? { state: attempt?.state ?? 'NOT_STARTED', fpxReceipt: readFpxReceipt(order, attempt) } : null,
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

type SettlementChannel =
  | { source: 'bank'; actorId: string; noteLength: number; paymentMethod: 'BANK_TRANSFER' }
  | { source: 'stripe'; attemptId: string; sessionId: string; paymentMethod: 'CARD' | 'FPX' }

/** Private delivery core: caller holds CREDIT, re-reads and verifies its channel.
 * Externally verified evidence alone cannot authorize settlement.
 */
async function settleOrder(
  tx: Prisma.TransactionClient, order: Order, snapshot: CommercialSnapshotV1, evidence: SettlementChannel,
): Promise<SettlementResult> {
  if (order.status === 'PAID') {
    const subscription = await tx.subscription.findUnique({ where: { orderId: order.id }, select: { id: true } })
    return { orderId: order.id, alreadyPaid: true, subscriptionId: subscription?.id ?? null }
  }
  const paidAt = new Date()
  const actorId = evidence.source === 'bank' ? evidence.actorId : undefined
  const terms = snapshot.delivery.subscription
  const startsAt = terms ? await subscriptionTail(tx, order.companyId, order.planId, paidAt) : null
  const endsAt = startsAt && terms ? subscriptionEnd(startsAt, terms.durationDays) : null
  const updated = await tx.order.updateMany({
    where: {
      id: order.id, companyId: order.companyId, currency: order.currency,
      status: evidence.source === 'bank' ? 'AWAITING_CONFIRMATION' : 'PENDING',
      paymentProvider: evidence.source === 'bank' ? 'BANK_TRANSFER' : 'STRIPE',
      ...(evidence.source === 'stripe' ? { externalRef: evidence.sessionId } : {}),
      updatedAt: order.updatedAt, amountSen: order.amountSen,
    },
    data: { status: 'PAID', paidAt, confirmedById: actorId ?? null, paymentMethod: evidence.paymentMethod },
  })
  if (updated.count !== 1) throw new ConflictError('Order changed; retry')
  await createWallet(tx, order.companyId)
  if (snapshot.delivery.credits > 0) await applyLedgerEntry(tx, {
    companyId: order.companyId, delta: snapshot.delivery.credits,
    reason: order.kind === 'PLAN' ? 'PLAN_GRANT' : 'PURCHASE',
    refType: 'Order', refId: order.id, actorId,
  })
  const subscription = startsAt && endsAt ? await tx.subscription.create({
    data: { companyId: order.companyId, planId: order.planId, orderId: order.id, startsAt, endsAt, status: 'ACTIVE' },
    select: { id: true },
  }) : null
  await logAudit({
    actorId, action: 'order.confirm', targetType: 'Order', targetId: order.id,
    metadata: {
      source: evidence.source, fromStatus: order.status, toStatus: 'PAID',
      amountSen: order.amountSen, discountSen: order.discountSen, currency: order.currency,
      creditsGranted: snapshot.delivery.credits, subscriptionId: subscription?.id ?? null,
      ...(evidence.source === 'bank' ? { noteLength: evidence.noteLength } : { attemptId: evidence.attemptId }),
    },
  }, tx)
  return { orderId: order.id, alreadyPaid: false, subscriptionId: subscription?.id ?? null }
}

async function notifySettlementCommitted(companyId: string, amountSen: number, result: SettlementResult): Promise<void> {
  // Issuance runs after commit; replay also recovers a previously failed issuance.
  try {
    const { ensureInvoiceForPaidOrder } = await import('./invoices')
    await ensureInvoiceForPaidOrder(result.orderId)
  } catch {
    logger.error({ orderId: result.orderId, code: 'INVOICE_ISSUANCE_PENDING' }, 'Paid order invoice requires recovery')
  }
  if (result.alreadyPaid) return
  try {
    await notifyOrderConfirmed(companyId, { orderId: result.orderId, amountSen })
  } catch {
    logger.error({ orderId: result.orderId, companyId }, 'Order confirmation notification failed')
  }
}

export interface VerifiedStripePayment {
  orderId: string
  companyId: string
  attemptId: string
  event: {
    id: string
    type: 'checkout.session.completed' | 'checkout.session.async_payment_succeeded'
    livemode: boolean
  }
  checkout: CheckoutObservation
  payment: PaymentObservation
}

const stripeRef = (prefix: string) => z.string().max(255).regex(new RegExp('^' + prefix + '[a-zA-Z0-9_]+$'))
const verifiedStripePaymentSchema = z.object({
  orderId: idSchema, companyId: idSchema, attemptId: idSchema,
  event: z.object({
    id: stripeRef('evt_'), type: z.enum(['checkout.session.completed', 'checkout.session.async_payment_succeeded']),
    livemode: z.boolean(),
  }),
  checkout: z.object({
    sessionId: stripeRef('cs_'), mode: z.literal('payment'),
    status: z.enum(['open', 'complete', 'expired']).nullable(),
    paymentStatus: z.enum(['paid', 'unpaid', 'no_payment_required']),
    amountTotalSen: positiveInt.nullable(), currency: z.string().nullable(),
    clientReferenceId: idSchema.nullable(), orderId: idSchema.nullable(), companyId: idSchema.nullable(),
    paymentIntentId: stripeRef('pi_').nullable(), livemode: z.boolean(),
  }),
  payment: z.object({
    paymentIntentId: stripeRef('pi_'),
    status: z.enum(['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded']),
    amountSen: positiveInt, amountReceivedSen: nonnegativeInt, currency: z.string(),
    orderId: idSchema.nullable(), companyId: idSchema.nullable(), livemode: z.boolean(),
    latestCharge: z.object({
      chargeId: stripeRef('ch_'), paymentIntentId: stripeRef('pi_').nullable(),
      createdAt: isoDate, statementDescriptor: receiptText.nullable(),
      fpx: z.object({ transactionId: receiptText.nullable(), bankCode: receiptText }).nullable(),
      status: z.enum(['succeeded', 'pending', 'failed']), paid: z.boolean(),
      amountSen: positiveInt, currency: z.string(), livemode: z.boolean(),
      refunded: z.boolean(), amountRefundedSen: nonnegativeInt,
      paymentMethod: z.enum(['card', 'fpx']).nullable(),
    }).nullable(),
  }),
})
function stripeRejected(): AppError {
  return new AppError('Payment facts rejected', 'PAYMENT_REJECTED', 400)
}
function stripeUnavailable(): AppError {
  return new AppError('Payment temporarily unavailable', 'PAYMENT_UNAVAILABLE', 503)
}

/** Server-only entry; SDK reads happen before this function, never in its transaction. */
export async function settleStripeOrder(evidence: VerifiedStripePayment): Promise<SettlementResult> {
  try {
    const parsed = verifiedStripePaymentSchema.safeParse(evidence)
    if (!parsed.success) throw stripeRejected()
    const facts = parsed.data
    const settled = await db.$transaction(async tx => {
      await lockXact(tx, LOCK_NS.CREDIT, facts.companyId)
      const order = await tx.order.findUnique({ where: { id: facts.orderId } })
      if (!order || order.companyId !== facts.companyId || order.paymentProvider !== 'STRIPE'
        || !['PENDING', 'PAID'].includes(order.status)) throw stripeRejected()
      const snapshot = snapshotOf(order)
      if (!snapshot) throw stripeRejected()
      const attempt = await tx.stripeCheckoutAttempt.findUnique({ where: { orderId: order.id } })
      if (!attempt || attempt.id !== facts.attemptId) throw stripeRejected()
      const mode = env.STRIPE_MODE ?? 'test'
      if (mode !== 'test' && mode !== 'live') throw stripeUnavailable()
      readStripeAttemptSnapshot(order, attempt, mode)
      if (attempt.sessionId === null) throw stripeUnavailable()
      const checkout = facts.checkout
      const payment = facts.payment
      const live = mode === 'live'
      if (facts.event.livemode !== live || checkout.livemode !== live || payment.livemode !== live
        || checkout.sessionId !== attempt.sessionId || order.externalRef !== checkout.sessionId
        || checkout.orderId !== order.id || checkout.clientReferenceId !== order.id
        || checkout.companyId !== order.companyId || checkout.amountTotalSen !== order.amountSen
        || checkout.currency?.toLowerCase() !== 'myr' || checkout.paymentStatus === 'no_payment_required'
        || payment.orderId !== order.id || payment.companyId !== order.companyId
        || payment.currency.toLowerCase() !== 'myr' || payment.amountSen !== order.amountSen) throw stripeRejected()
      if (checkout.paymentStatus !== 'paid' || checkout.paymentIntentId === null) throw stripeUnavailable()
      if (checkout.status === 'expired') throw stripeRejected()
      if (checkout.status !== 'complete') throw stripeUnavailable()
      if (payment.paymentIntentId !== checkout.paymentIntentId
        || (attempt.paymentIntentId !== null && attempt.paymentIntentId !== payment.paymentIntentId)) throw stripeRejected()
      if (payment.status === 'canceled' || payment.status === 'requires_payment_method') throw stripeRejected()
      if (payment.status !== 'succeeded' || payment.latestCharge === null) throw stripeUnavailable()
      if (payment.amountReceivedSen !== order.amountSen) throw stripeRejected()
      const charge = payment.latestCharge
      if (charge.paymentIntentId !== payment.paymentIntentId || charge.livemode !== live
        || !charge.paid || charge.status !== 'succeeded' || charge.refunded || charge.amountRefundedSen !== 0
        || charge.amountSen !== order.amountSen || charge.currency.toLowerCase() !== 'myr'
        || charge.paymentMethod === null || !Number.isFinite(new Date(charge.createdAt).getTime())) throw stripeRejected()
      const paymentMethod = charge.paymentMethod === 'card' ? 'CARD' : 'FPX'
      if ((order.status === 'PAID' && order.paymentMethod !== paymentMethod)
        || (order.paymentMethod !== null && order.paymentMethod !== paymentMethod)) throw stripeRejected()
      if (charge.paymentMethod === 'fpx' && charge.fpx === null) throw stripeRejected()
      const receipt: FpxReceiptSnapshotV1 | null = charge.paymentMethod === 'fpx' && charge.fpx ? {
        version: 1, createdAt: charge.createdAt, amountSen: order.amountSen, currency: 'MYR',
        orderNo: order.orderNo, sellerOrderNo: charge.statementDescriptor,
        transactionId: charge.fpx.transactionId, bankCode: charge.fpx.bankCode, status: 'succeeded',
      } : null
      if (attempt.fpxReceipt !== null && (order.status !== 'PAID' || receipt === null
        || !validFpxReceipt(attempt.fpxReceipt, order))) throw stripeRejected()
      if (attempt.paymentIntentId === null) {
        const attached = await tx.stripeCheckoutAttempt.updateMany({
          where: { id: attempt.id, orderId: order.id, sessionId: checkout.sessionId, paymentIntentId: null },
          data: { paymentIntentId: payment.paymentIntentId },
        })
        if (attached.count !== 1) throw stripeUnavailable()
      }
      const result = await settleOrder(tx, order, snapshot, {
        source: 'stripe', attemptId: attempt.id, sessionId: checkout.sessionId, paymentMethod,
      })
      // A duplicate validates the payment but never replaces its first receipt.
      const needsReceipt = receipt !== null && attempt.fpxReceipt === null
      if (attempt.state !== 'SUCCEEDED' || needsReceipt) {
        const updated = await tx.stripeCheckoutAttempt.updateMany({
          where: {
            id: attempt.id, orderId: order.id, sessionId: checkout.sessionId,
            paymentIntentId: payment.paymentIntentId, state: attempt.state,
          },
          data: { state: 'SUCCEEDED', ...(needsReceipt ? { fpxReceipt: { ...receipt! } } : {}) },
        })
        if (updated.count !== 1) throw stripeUnavailable()
      }
      return { result, companyId: order.companyId, amountSen: order.amountSen }
    }, TRANSACTION_OPTIONS)
    await notifySettlementCommitted(settled.companyId, settled.amountSen, settled.result)
    return settled.result
  } catch (error) {
    if (error instanceof AppError && error.code === 'PAYMENT_REJECTED') throw stripeRejected()
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target
      if (Array.isArray(target) && target.includes('paymentIntentId')) throw stripeRejected()
    }
    throw stripeUnavailable()
  }
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
      source: 'bank', actorId: ctx.userId, paymentMethod: 'BANK_TRANSFER', noteLength: data.note.length,
    })
    return { result, amountSen: order.amountSen }
  }, TRANSACTION_OPTIONS)
  await notifySettlementCommitted(located.companyId, settled.amountSen, settled.result)
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
