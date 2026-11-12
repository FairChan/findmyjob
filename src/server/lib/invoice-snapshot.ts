import { z } from 'zod'

export const INVOICE_TEMPLATE_VERSION = 'invoice-v1'
export const INVOICE_FONT_VERSION = 'findmyjob-invoice-sc-2.004-static400-v1'
export const INVOICE_SNAPSHOT_MAX_BYTES = 32 * 1024
export const INVOICE_NUMBER_SCOPE = 'FMJ-INV'

const positiveSen = z.number().int().min(1).max(2_147_483_647)
const nonnegativeSen = z.number().int().min(0).max(2_147_483_647)
const nonblank = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0)
const legalName = nonblank(200).refine(value => value.length >= 2)
const invoiceNumber = z.string()
  .regex(/^FMJ-INV-(?:[0-9]{8}|[1-9][0-9]{8,18})$/)
  .refine(value => {
    const digits = value.slice('FMJ-INV-'.length)
    if (!/^[0-9]{8,19}$/.test(digits)) return false
    const number = BigInt(digits)
    return number > 0n && number <= 9_223_372_036_854_775_807n
  })
const isoDate = z.iso.datetime({ precision: 3 })

/**
 * Immutable billing facts, shared by issuance, rendering and downloads.
 * Validation preserves every legal-name/address character; it never truncates or trims.
 * Keep this module independent of services, storage, workers and database clients.
 */
export const invoiceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  templateVersion: z.literal(INVOICE_TEMPLATE_VERSION),
  fontAssetVersion: z.literal(INVOICE_FONT_VERSION),
  invoiceNo: invoiceNumber,
  issuedAt: isoDate,
  orderId: nonblank(200),
  orderNo: nonblank(200),
  paidAt: isoDate,
  issuer: z.object({
    legalName,
    address: nonblank(500),
    registrationNo: z.string().max(50).nullable(),
    configVersion: nonblank(100),
  }).strict(),
  buyer: z.object({
    legalName,
    ssmRegNo: z.string().max(50).nullable(),
    address: z.string().max(500).nullable(),
  }).strict(),
  item: z.object({
    planCode: z.string().min(1).max(64).regex(/^[A-Z0-9_]+$/),
    kind: z.enum(['PLAN', 'CREDIT_PACK']),
    nameZh: nonblank(100),
    nameEn: nonblank(100),
    quantity: z.literal(1),
  }).strict(),
  money: z.object({
    currency: z.literal('MYR'),
    listPriceSen: positiveSen,
    discountSen: nonnegativeSen,
    payableSen: positiveSen,
  }).strict(),
  tax: z.object({
    status: z.literal('NOT_CONFIGURED'),
    registrationNo: z.null(),
    rate: z.null(),
    amountSen: z.null(),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.money.listPriceSen - value.money.discountSen !== value.money.payableSen) {
    ctx.addIssue({ code: 'custom', path: ['money'], message: 'Invoice amounts do not reconcile' })
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > INVOICE_SNAPSHOT_MAX_BYTES) {
    ctx.addIssue({ code: 'custom', message: 'Invoice snapshot exceeds its byte budget' })
  }
})

export type InvoiceSnapshot = z.infer<typeof invoiceSnapshotSchema>
