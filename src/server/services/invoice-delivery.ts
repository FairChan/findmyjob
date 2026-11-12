import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '../db'
import { AppError, ForbiddenError, NotFoundError } from '../errors'
import type { UserCtx } from '../authz'
import { logger } from '../lib/logger'
import { INVOICE_SNAPSHOT_MAX_BYTES, invoiceSnapshotSchema, type InvoiceSnapshot } from '../lib/invoice-snapshot'
import { renderInvoicePdf } from '../lib/invoice-pdf'
import { deleteAllVersions, getObjectBytes, putObject } from '@/lib/storage'

const MAX_PDF_BYTES = 8 * 1024 * 1024
const MAX_ATTEMPTS = 3
const LEASE_MS = 60_000
const DEADLINE_MS = 30_000
const IO_MS = 5_000
const RENDER_MS = 15_000
const RETRY_MS = [60_000, 300_000] as const
const PDF_MAGIC = Buffer.from('%PDF-')
const idSchema = z.string().cuid()
const pathSegment = /^[A-Za-z0-9_-]{1,200}$/
const safeInvoiceNumber = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/
const permanentCodes = [
  'INVALID_INVOICE_SNAPSHOT', 'LEGACY_INVOICE_SNAPSHOT_MISSING', 'UNSUPPORTED_GLYPH',
  'PDF_LAYOUT_EXCEEDED', 'PDF_TOO_LARGE', 'PDF_FONT_UNAVAILABLE',
] as const

type InvoiceWithOrder = Prisma.InvoiceGetPayload<{ include: { order: { select: { companyId: true } } } }>
type Claim = { invoice: InvoiceWithOrder; token: string }
type Budget = { expiresAt: number; signal: AbortSignal; close: () => void }
type Failure = { code: typeof permanentCodes[number] | 'PDF_RENDER_FAILED' | 'PDF_STORAGE_FAILED'; retry: boolean }
export interface InvoiceDownload { bytes: Buffer; invoiceNo: string }

// Only a local resource limit. Cross-process ownership always comes from the persisted CAS.
let processing = false

function unavailable(): AppError {
  return new AppError('Invoice PDF is unavailable', 'INVOICE_PDF_UNAVAILABLE', 503)
}

function pending(): AppError {
  return new AppError('Invoice PDF is pending', 'INVOICE_PDF_PENDING', 409)
}

function newBudget(): Budget {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS)
  return {
    expiresAt: performance.now() + DEADLINE_MS,
    signal: controller.signal,
    close: () => { clearTimeout(timer); controller.abort() },
  }
}

function remaining(budget: Budget): number {
  return budget.signal.aborted ? 0 : Math.max(0, Math.floor(budget.expiresAt - performance.now()))
}

async function shortTransaction<T>(budget: Budget, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const milliseconds = Math.min(IO_MS, remaining(budget))
  if (milliseconds < 4) throw unavailable()
  const maxWait = Math.max(1, Math.min(1_000, Math.floor(milliseconds / 4)))
  return db.$transaction(operation, { maxWait, timeout: milliseconds - maxWait })
}

/** Await cancellation completion; never abandon a renderer or S3 operation with Promise.race. */
async function withSignal<T>(budget: Budget, limit: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const milliseconds = Math.min(limit, remaining(budget))
  if (milliseconds < 1) throw unavailable()
  const controller = new AbortController()
  const abort = () => controller.abort()
  budget.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, milliseconds)
  try {
    if (budget.signal.aborted) controller.abort()
    if (controller.signal.aborted) throw unavailable()
    const result = await operation(controller.signal)
    if (controller.signal.aborted) throw unavailable()
    return result
  } finally {
    clearTimeout(timer)
    budget.signal.removeEventListener('abort', abort)
  }
}

function due(now: Date): Prisma.InvoiceWhereInput {
  return { OR: [
    { pdfStatus: 'QUEUED', OR: [{ pdfNextAttemptAt: null }, { pdfNextAttemptAt: { lte: now } }] },
    { pdfStatus: 'FAILED', pdfNextAttemptAt: { lte: now } },
    { pdfStatus: 'PROCESSING', OR: [{ pdfLeaseExpiresAt: null }, { pdfLeaseExpiresAt: { lte: now } }] },
  ] }
}

async function claimInvoice(invoiceId: string, budget: Budget): Promise<Claim | null> {
  return shortTransaction(budget, async tx => {
    const now = new Date()
    // A crash on the final claim must not leave an expired PROCESSING row forever.
    await tx.invoice.updateMany({
      where: { id: invoiceId, pdfAttempts: { gte: MAX_ATTEMPTS }, ...due(now) },
      data: { pdfStatus: 'FAILED', pdfErrorCode: 'PDF_LEASE_EXPIRED', pdfNextAttemptAt: null,
        pdfLeaseToken: null, pdfLeaseExpiresAt: null },
    })
    const token = randomUUID()
    const claimed = await tx.invoice.updateMany({
      where: { id: invoiceId, pdfAttempts: { gte: 0, lt: MAX_ATTEMPTS }, ...due(now) },
      data: { pdfStatus: 'PROCESSING', pdfAttempts: { increment: 1 }, pdfNextAttemptAt: null,
        pdfLeaseToken: token, pdfLeaseExpiresAt: new Date(now.getTime() + LEASE_MS), pdfErrorCode: null },
    })
    if (claimed.count !== 1) return null
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId }, include: { order: { select: { companyId: true } } },
    })
    return { invoice, token }
  })
}

function snapshotFor(invoice: InvoiceWithOrder): InvoiceSnapshot {
  if (invoice.invoiceSnapshot === null) {
    throw new AppError('Invoice snapshot is unavailable', 'LEGACY_INVOICE_SNAPSHOT_MISSING', 503)
  }
  const serialized = JSON.stringify(invoice.invoiceSnapshot)
  const parsed = typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= INVOICE_SNAPSHOT_MAX_BYTES
    ? invoiceSnapshotSchema.safeParse(invoice.invoiceSnapshot) : null
  if (!parsed?.success || parsed.data.invoiceNo !== invoice.invoiceNo || parsed.data.orderId !== invoice.orderId
    || !Number.isFinite(invoice.issuedAt.getTime()) || parsed.data.issuedAt !== invoice.issuedAt.toISOString()) {
    throw new AppError('Invoice snapshot is unavailable', 'INVALID_INVOICE_SNAPSHOT', 503)
  }
  return parsed.data
}

function isPdf(bytes: unknown): bytes is Buffer {
  return Buffer.isBuffer(bytes) && bytes.length >= PDF_MAGIC.length && bytes.length <= MAX_PDF_BYTES
    && bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
}

function failureFor(error: unknown, phase: 'render' | 'upload'): Failure {
  const permanent = permanentCodes.find(code => error instanceof AppError && error.code === code)
  return permanent ? { code: permanent, retry: false }
    : { code: phase === 'upload' ? 'PDF_STORAGE_FAILED' : 'PDF_RENDER_FAILED', retry: true }
}

function retryAt(attempt: number, now: Date): Date {
  return new Date(now.getTime() + RETRY_MS[attempt <= 1 ? 0 : 1])
}

function ownedLease(claim: Claim, now: Date): Prisma.InvoiceWhereInput {
  return { id: claim.invoice.id, pdfStatus: 'PROCESSING', pdfLeaseToken: claim.token,
    pdfAttempts: claim.invoice.pdfAttempts, pdfLeaseExpiresAt: { gt: now } }
}

async function markFailure(claim: Claim, failure: Failure, budget: Budget): Promise<void> {
  await shortTransaction(budget, async tx => {
    const now = new Date()
    await tx.invoice.updateMany({
      where: ownedLease(claim, now),
      data: { pdfStatus: 'FAILED', pdfErrorCode: failure.code,
        pdfNextAttemptAt: failure.retry && claim.invoice.pdfAttempts < MAX_ATTEMPTS
          ? retryAt(claim.invoice.pdfAttempts, now) : null,
        pdfLeaseToken: null, pdfLeaseExpiresAt: null, pdfKey: null, pdfSha256: null, pdfSizeBytes: null },
    })
  })
}

function candidateFor(claim: Claim): string {
  if (!pathSegment.test(claim.invoice.order.companyId) || !pathSegment.test(claim.invoice.id)
    || !pathSegment.test(claim.token)) throw new AppError('Invoice snapshot is unavailable', 'INVALID_INVOICE_SNAPSHOT', 503)
  return `invoices/${claim.invoice.order.companyId}/${claim.invoice.id}/${claim.token}.pdf`
}

async function removeCandidate(claim: Claim, key: string, budget: Budget): Promise<void> {
  if (key !== candidateFor(claim)) return
  try {
    if (remaining(budget) === 0) throw unavailable()
    const current = await shortTransaction(budget, tx => tx.invoice.findUnique({
      where: { id: claim.invoice.id }, select: { pdfKey: true },
    }))
    if (current?.pdfKey === key) return
    await withSignal(budget, IO_MS, signal => deleteAllVersions(key, { signal }))
  } catch {
    logger.warn({ invoiceId: claim.invoice.id, attempt: claim.invoice.pdfAttempts, code: 'PDF_CANDIDATE_CLEANUP_REQUIRED' },
      'Invoice PDF candidate requires bounded cleanup')
  }
}

async function publish(claim: Claim, snapshot: InvoiceSnapshot, key: string, bytes: Buffer, budget: Budget): Promise<boolean> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return shortTransaction(budget, async tx => {
    const result = await tx.invoice.updateMany({
      where: { ...ownedLease(claim, new Date()), orderId: claim.invoice.orderId,
        invoiceNo: claim.invoice.invoiceNo, issuedAt: claim.invoice.issuedAt, invoiceSnapshot: { equals: snapshot } },
      data: { pdfStatus: 'READY', pdfKey: key, pdfSha256: sha256, pdfSizeBytes: bytes.length,
        pdfErrorCode: null, pdfNextAttemptAt: null, pdfLeaseToken: null, pdfLeaseExpiresAt: null },
    })
    return result.count === 1
  })
}

/** Internal worker entry. A busy local renderer leaves the durable work untouched for a later run. */
export async function processInvoicePdf(invoiceId: string): Promise<void> {
  if (!idSchema.safeParse(invoiceId).success) throw new NotFoundError()
  if (processing) return
  processing = true
  const budget = newBudget()
  let claim: Claim | null = null
  let key: string | null = null
  let uploadStarted = false
  let publicationUnknown = false
  let phase: 'render' | 'upload' = 'render'
  try {
    claim = await claimInvoice(invoiceId, budget)
    if (!claim) return
    const snapshot = snapshotFor(claim.invoice)
    key = candidateFor(claim)
    const bytes = await withSignal(budget, RENDER_MS, signal => renderInvoicePdf(snapshot, signal))
    if (Buffer.isBuffer(bytes) && bytes.length > MAX_PDF_BYTES) {
      throw new AppError('Invoice exceeds its PDF budget', 'PDF_TOO_LARGE', 503)
    }
    if (!isPdf(bytes)) throw new AppError('Invoice render failed', 'PDF_RENDER_FAILED', 503)
    phase = 'upload'
    uploadStarted = true
    await withSignal(budget, IO_MS, signal => putObject(key!, bytes, 'application/pdf', { signal }))
    // A failed commit acknowledgement may still have published this key. Never delete on that path.
    publicationUnknown = true
    const published = await publish(claim, snapshot, key, bytes, budget)
    publicationUnknown = false
    if (!published) await removeCandidate(claim, key, budget)
  } catch (error) {
    if (!claim || publicationUnknown) {
      logger.warn({ invoiceId, code: publicationUnknown ? 'PDF_PUBLICATION_OUTCOME_UNKNOWN' : 'PDF_CLAIM_UNAVAILABLE' },
        'Invoice PDF state requires recovery')
      throw unavailable()
    }
    let statePending = false
    try { await markFailure(claim, failureFor(error, phase), budget) } catch {
      statePending = true
      logger.warn({ invoiceId, attempt: claim.invoice.pdfAttempts, code: 'PDF_RETRY_STATE_PENDING' },
        'Invoice PDF lease will recover the unfinished attempt')
    }
    if (uploadStarted && key !== null) await removeCandidate(claim, key, budget)
    if (statePending) throw unavailable()
  } finally {
    budget.close()
    processing = false
  }
}

/** At most 50 candidates per existing runner invocation; no in-process background dispatch. */
export async function processInvoicePdfBatch(): Promise<void> {
  const budget = newBudget()
  let rows: { id: string }[]
  try {
    rows = await shortTransaction(budget, tx => tx.invoice.findMany({
      where: due(new Date()), orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }], take: 50, select: { id: true },
    }))
  } catch { throw unavailable() } finally { budget.close() }
  let failed = false
  for (const row of rows) {
    try { await processInvoicePdf(row.id) } catch { failed = true }
  }
  if (failed) throw unavailable()
}

async function authorizedInvoice(ctx: UserCtx, invoiceId: string, budget: Budget): Promise<InvoiceWithOrder> {
  return shortTransaction(budget, async tx => {
    const member = await tx.companyMember.findUnique({
      where: { userId: ctx.userId },
      select: { companyId: true, role: true, company: { select: { isActive: true } },
        user: { select: { status: true, role: true } } },
    })
    if (!member || member.role !== 'OWNER' || member.user.role !== 'EMPLOYER'
      || member.user.status !== 'ACTIVE' || !member.company.isActive) throw new ForbiddenError()
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, order: { companyId: member.companyId } },
      include: { order: { select: { companyId: true } } },
    })
    if (!invoice) throw new NotFoundError()
    return invoice
  })
}

function validReadyMetadata(invoice: InvoiceWithOrder): boolean {
  return invoice.pdfStatus === 'READY' && safeInvoiceNumber.test(invoice.invoiceNo)
    && typeof invoice.pdfKey === 'string' && invoice.pdfKey.length > 0 && invoice.pdfKey.length <= 1024
    && !/[\u0000-\u001F\u007F]/.test(invoice.pdfKey)
    && (invoice.pdfSizeBytes === null || (Number.isSafeInteger(invoice.pdfSizeBytes)
      && invoice.pdfSizeBytes >= PDF_MAGIC.length && invoice.pdfSizeBytes <= MAX_PDF_BYTES))
    && (invoice.pdfSha256 === null || /^[a-f0-9]{64}$/.test(invoice.pdfSha256))
}

function sameReadyObject(before: InvoiceWithOrder, after: InvoiceWithOrder): boolean {
  return after.pdfStatus === 'READY' && before.orderId === after.orderId && before.invoiceNo === after.invoiceNo
    && before.pdfKey === after.pdfKey && before.pdfSha256 === after.pdfSha256
    && before.pdfSizeBytes === after.pdfSizeBytes && before.pdfAttempts === after.pdfAttempts
}

/** Mark a broken READY object once; GET never renders, issues, resets attempts or deletes objects. */
async function markUnavailable(invoice: InvoiceWithOrder, budget: Budget, confirmedBroken = true): Promise<void> {
  let retry = false
  let rebuildable = false
  try {
    snapshotFor(invoice)
    rebuildable = confirmedBroken
    retry = confirmedBroken && invoice.pdfAttempts < MAX_ATTEMPTS
  } catch { /* A transient read error must not erase the only legacy PDF reference. */ }
  try {
    await shortTransaction(budget, tx => tx.invoice.updateMany({
      where: { id: invoice.id, pdfStatus: 'READY', pdfKey: invoice.pdfKey,
        pdfSha256: invoice.pdfSha256, pdfSizeBytes: invoice.pdfSizeBytes, pdfAttempts: invoice.pdfAttempts },
      data: rebuildable ? { pdfStatus: 'FAILED', pdfErrorCode: 'PDF_STORAGE_FAILED',
        pdfNextAttemptAt: retry ? retryAt(invoice.pdfAttempts, new Date()) : null,
        pdfKey: null, pdfSha256: null, pdfSizeBytes: null, pdfLeaseToken: null, pdfLeaseExpiresAt: null }
        : { pdfErrorCode: 'PDF_STORAGE_FAILED' },
    }))
  } catch {
    logger.warn({ invoiceId: invoice.id, code: 'PDF_DOWNLOAD_RECOVERY_REQUIRED' }, 'Invoice PDF requires recovery')
  }
}

function safeDownloadError(error: unknown): AppError {
  if (error instanceof AppError) {
    if (error.code === 'FORBIDDEN') return new ForbiddenError()
    if (error.code === 'NOT_FOUND') return new NotFoundError()
    if (error.code === 'INVOICE_PDF_PENDING') return pending()
  }
  return unavailable()
}

/** Current OWNER only. No verification, sales, issuer or current Plan gate applies to historical PDFs. */
export async function getInvoiceDownload(ctx: UserCtx, invoiceId: string): Promise<InvoiceDownload> {
  const budget = newBudget()
  try {
    if (!idSchema.safeParse(invoiceId).success) throw new NotFoundError()
    const before = await authorizedInvoice(ctx, invoiceId, budget)
    if (before.pdfStatus === 'QUEUED' || before.pdfStatus === 'PROCESSING') throw pending()
    if (before.pdfStatus !== 'READY') throw unavailable()
    if (!validReadyMetadata(before)) {
      await markUnavailable(before, budget)
      throw unavailable()
    }
    let bytes: Buffer | null = null
    let readFailed = false
    let confirmedBroken = false
    try {
      bytes = await withSignal(budget, IO_MS, signal => getObjectBytes(before.pdfKey!, { maxBytes: MAX_PDF_BYTES, signal }))
    } catch (error) {
      readFailed = true
      // A definite missing or oversized object warrants rebuilding. Network, permission,
      // timeout and cancellation errors do not prove the stored PDF is damaged.
      confirmedBroken = error instanceof Error && (error.name === 'NoSuchKey'
        || ('code' in error && error.code === 'FILE_TOO_LARGE'))
    }
    const after = await authorizedInvoice(ctx, invoiceId, budget)
    if (!sameReadyObject(before, after)) throw unavailable()
    if (readFailed) {
      await markUnavailable(after, budget, confirmedBroken)
      throw unavailable()
    }
    if (!isPdf(bytes) || (before.pdfSizeBytes !== null && bytes.length !== before.pdfSizeBytes)
      || (before.pdfSha256 !== null && createHash('sha256').update(bytes).digest('hex') !== before.pdfSha256)) {
      await markUnavailable(after, budget)
      throw unavailable()
    }
    return { bytes, invoiceNo: after.invoiceNo }
  } catch (error) {
    throw safeDownloadError(error)
  } finally {
    budget.close()
  }
}
