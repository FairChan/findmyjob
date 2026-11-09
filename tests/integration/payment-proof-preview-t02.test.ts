import { randomUUID } from 'node:crypto'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFArray, PDFDocument, PDFHexString, PDFName } from 'pdf-lib'

const io = vi.hoisted(() => ({
  read: vi.fn(), signedDownload: vi.fn(), signedDisplay: vi.fn(),
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(),
}))
vi.mock('@/server/auth', () => ({ getSession: vi.fn(), auth: {} }))
vi.mock('@/server/db', async () => ({ db: (await import('../setup/db')).testDb }))
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }))
vi.mock('@/lib/storage', () => ({
  getObjectBytes: io.read, getSignedDownloadUrl: io.signedDownload,
  getSignedDisplayUrl: io.signedDisplay, putObject: vi.fn(), deleteAllVersions: vi.fn(),
}))
vi.mock('@/server/lib/logger', () => ({ logger: {
  error: io.error, warn: io.warn, info: io.info, debug: io.debug,
} }))

import { setupTestDb, testDb } from '../setup/db'
import { createEmployer, createStudent } from '../factories'
import { billingFixture, pendingOrder, PROOF_BYTES, BANK_SETTING, setting } from '../helpers/billing-t02'
import { getSession } from '@/server/auth'
import { GET } from '@/app/api/admin/orders/[orderId]/payment-proof/route'

setupTestDb()
const MAX_PROOF_BYTES = 10 * 1024 * 1024
const PRIVATE_CONTENT = 'SYNTHETIC_RECEIPT_CONTENT_4815162342'
const BANK = {
  bankName: 'SYNTHETIC_BANK_PREVIEW_801', accountName: 'SYNTHETIC_PAYEE_PREVIEW_802',
  accountNumber: '0000000000000803', instructions: 'SYNTHETIC_INSTRUCTIONS_PREVIEW_804; TEST ONLY',
}
const responses: Response[] = []

beforeEach(() => {
  vi.resetAllMocks()
  responses.length = 0
  io.read.mockResolvedValue(PROOF_BYTES)
})
afterEach(async () => {
  for (const response of responses) {
    if (response.body && !response.bodyUsed) await response.body.cancel()
  }
})

function session(userId: string | null, options: { createdAt?: Date; verifiedAt?: Date | null } = {}) {
  if (userId === null) { vi.mocked(getSession).mockResolvedValue(null); return }
  vi.mocked(getSession).mockResolvedValue({
    // Deliberately stale role claims: real authz must use the persisted user row.
    user: { id: userId, role: 'ADMIN', status: 'ACTIVE' } as never,
    session: {
      id: 'synthetic-preview-session', userId, token: 'synthetic-preview-token',
      createdAt: options.createdAt ?? new Date(), updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000), ipAddress: null, userAgent: null,
      twoFactorVerifiedAt: options.verifiedAt === undefined ? new Date() : options.verifiedAt,
    },
  })
}

async function preview(orderId: string, options: { signal?: AbortSignal } = {}) {
  // Existing route wrapper has a single Request argument; no invented params object.
  const response = await GET(new Request(
    `http://localhost/api/admin/orders/${encodeURIComponent(orderId)}/payment-proof`,
    { signal: options.signal },
  ))
  responses.push(response)
  return response
}

async function fixture(bytes = PROOF_BYTES, mimeType = 'image/png') {
  const f = await billingFixture()
  const order = await pendingOrder(f)
  const extension = mimeType === 'application/pdf' ? 'pdf' : 'png'
  const proof = await testDb.paymentProofUpload.create({ data: {
    companyId: f.ctx.companyId, uploaderId: f.ctx.userId,
    storageKey: `payment_proofs/${f.ctx.companyId}/${randomUUID()}.${extension}`,
    mimeType, sizeBytes: bytes.length,
  } })
  // Route fixture: upload/attach writes have their own T02 tests; no duplicate coverage here.
  await testDb.order.update({ where: { id: order.id }, data: {
    status: 'AWAITING_CONFIRMATION', proofKey: proof.storageKey,
  } })
  await testDb.user.update({ where: { id: f.adminCtx.userId }, data: { twoFactorEnabled: true } })
  await setting(BANK_SETTING, BANK)
  session(f.adminCtx.userId)
  io.read.mockReset().mockResolvedValue(bytes)
  return { ...f, order, proof }
}

type Fixture = Awaited<ReturnType<typeof fixture>>
async function financialState(f: Fixture) {
  return {
    order: await testDb.order.findUniqueOrThrow({ where: { id: f.order.id } }),
    ledger: await testDb.creditLedger.findMany({ where: { refId: f.order.id }, orderBy: { id: 'asc' } }),
    subscriptions: await testDb.subscription.findMany({ where: { orderId: f.order.id }, orderBy: { id: 'asc' } }),
    wallet: await testDb.creditWallet.findUnique({ where: { companyId: f.ctx.companyId } }),
    confirmations: await testDb.auditLog.findMany({ where: { action: 'order.confirm', targetId: f.order.id }, orderBy: { id: 'asc' } }),
  }
}

function privateHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-robots-tag')).toMatch(/\bnoindex\b/)
  expect(response.headers.get('location')).toBeNull()
}

async function noLeaks(f: Fixture, body = '') {
  const audits = await testDb.auditLog.findMany()
  const proofs = await testDb.paymentProofUpload.findMany({ select: { storageKey: true } })
  const logs = inspect([io.error.mock.calls, io.warn.mock.calls, io.info.mock.calls, io.debug.mock.calls], { depth: null })
  const observations = [body, logs, JSON.stringify(audits)]
  for (const output of observations) {
    for (const sentinel of [f.proof.storageKey, ...proofs.map(proof => proof.storageKey), PRIVATE_CONTENT, ...Object.values(BANK)]) {
      expect(output).not.toContain(sentinel)
    }
  }
  expect(io.signedDownload).not.toHaveBeenCalled()
  expect(io.signedDisplay).not.toHaveBeenCalled()
}

async function rejected(response: Response, f: Fixture, family: 'client' | 'any' = 'client') {
  // Exact preview error code/status is not frozen. Do not accidentally require generic 500.
  expect(response.status).toBeGreaterThanOrEqual(400)
  expect(response.status).toBeLessThan(family === 'client' ? 500 : 600)
  privateHeaders(response)
  const body = await response.text()
  expect(body).not.toContain('INTERNAL_ERROR')
  await noLeaks(f, body + inspect([...response.headers]))
}

async function dangerousPdf() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([420, 595])
  page.drawText(PRIVATE_CONTENT, { x: 24, y: 550, size: 11 })
  const js = doc.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText('app.alert("synthetic")') })
  doc.catalog.set(PDFName.of('OpenAction'), js)
  doc.catalog.set(PDFName.of('AA'), doc.context.obj({ WC: js }))
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({
    JavaScript: { Names: [] }, EmbeddedFiles: { Names: [] },
  }))
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [] }))
  page.node.set(PDFName.of('AA'), doc.context.obj({ O: js }))
  page.node.set(PDFName.of('Annots'), doc.context.obj([
    doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [1, 1, 20, 20], A: js })),
    doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [21, 1, 40, 20], FS: { Type: 'Filespec', F: 'synthetic.txt' } })),
  ]))
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

describe('T02 admin-fresh proof preview authorization', () => {
  it.each([
    { actor: 'anonymous', code: 'FORBIDDEN' },
    { actor: 'student', code: 'FORBIDDEN' },
    { actor: 'owner', code: 'FORBIDDEN' },
    { actor: 'company-admin', code: 'FORBIDDEN' },
    { actor: 'recruiter', code: 'FORBIDDEN' },
    { actor: 'suspended-admin', code: 'FORBIDDEN' },
    { actor: 'deleted-admin', code: 'FORBIDDEN' },
    { actor: 'disabled-2fa', code: 'TWO_FACTOR_REQUIRED' },
    { actor: 'unverified-2fa', code: 'FORBIDDEN' },
    { actor: 'expired-session', code: 'FORBIDDEN' },
    { actor: 'nonfresh-2fa', code: 'FRESH_SESSION_REQUIRED' },
    { actor: 'future-2fa', code: 'FORBIDDEN' },
  ])('denies $actor before private object access', async ({ actor, code }) => {
    const f = await fixture()
    const before = await financialState(f)
    if (actor === 'anonymous') session(null)
    if (actor === 'student') session((await createStudent(testDb)).userId)
    if (actor === 'owner' || actor === 'company-admin' || actor === 'recruiter') {
      await testDb.companyMember.update({ where: { userId: f.ctx.userId }, data: {
        role: actor === 'owner' ? 'OWNER' : actor === 'company-admin' ? 'ADMIN' : 'RECRUITER',
      } })
      session(f.ctx.userId)
    }
    if (actor === 'suspended-admin' || actor === 'deleted-admin') {
      await testDb.user.update({ where: { id: f.adminCtx.userId }, data: { status: actor === 'suspended-admin' ? 'SUSPENDED' : 'DELETED' } })
    }
    if (actor === 'disabled-2fa') await testDb.user.update({ where: { id: f.adminCtx.userId }, data: { twoFactorEnabled: false } })
    if (actor === 'unverified-2fa') session(f.adminCtx.userId, { verifiedAt: null })
    if (actor === 'expired-session') session(f.adminCtx.userId, { createdAt: new Date(Date.now() - 12 * 3600_000) })
    if (actor === 'nonfresh-2fa') session(f.adminCtx.userId, { verifiedAt: new Date(Date.now() - 600_000) })
    if (actor === 'future-2fa') session(f.adminCtx.userId, { verifiedAt: new Date(Date.now() + 60_000) })
    const response = await preview(f.order.id)
    expect(response.status).toBe(403)
    privateHeaders(response)
    expect(await response.json()).toEqual({ ok: false, code })
    expect(io.read).not.toHaveBeenCalled()
    expect(await financialState(f)).toEqual(before)
    await noLeaks(f)
  })

  it('lets a current fresh admin read the bound PNG with private security headers', async () => {
    const f = await fixture()
    session(f.adminCtx.userId, { verifiedAt: new Date(Date.now() - 9 * 60_000) })
    const before = await financialState(f)
    const response = await preview(f.order.id)
    expect(response.status).toBe(200)
    privateHeaders(response)
    expect(response.headers.get('content-type')).toMatch(/^image\/png(?:;|$)/)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PROOF_BYTES)
    expect(io.read).toHaveBeenCalledTimes(1)
    expect(io.read.mock.calls[0][0]).toBe(f.proof.storageKey)
    const opts = io.read.mock.calls[0][1] as { maxBytes: number; signal: AbortSignal }
    expect(opts.maxBytes).toBeGreaterThan(0)
    expect(opts.maxBytes).toBeLessThanOrEqual(MAX_PROOF_BYTES)
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(await financialState(f)).toEqual(before)
    await noLeaks(f, inspect([...response.headers]))
  })

  it.each(['suspended', 'demoted', '2fa-disabled', 'session-revoked', 'freshness-expired'])(
    'does not deliver already-read bytes after %s', async change => {
      const f = await fixture()
      const before = await financialState(f)
      io.read.mockImplementationOnce(async () => {
        if (change === 'suspended') await testDb.user.update({ where: { id: f.adminCtx.userId }, data: { status: 'SUSPENDED' } })
        if (change === 'demoted') await testDb.user.update({ where: { id: f.adminCtx.userId }, data: { role: 'STUDENT' } })
        if (change === '2fa-disabled') await testDb.user.update({ where: { id: f.adminCtx.userId }, data: { twoFactorEnabled: false } })
        if (change === 'session-revoked') session(null)
        if (change === 'freshness-expired') session(f.adminCtx.userId, { verifiedAt: new Date(Date.now() - 600_000) })
        return PROOF_BYTES
      })
      const response = await preview(f.order.id)
      expect(response.status).toBe(403)
      await rejected(response, f)
      expect(io.read).toHaveBeenCalledTimes(1)
      expect(await financialState(f)).toEqual(before)
    },
  )
})

describe('T02 current-order proof binding and byte processing', () => {
  it('sanitizes a real PDF before delivery rather than returning the uploaded active document', async () => {
    const raw = await dangerousPdf()
    const beforeDoc = await PDFDocument.load(raw)
    expect(beforeDoc.catalog.has(PDFName.of('OpenAction'))).toBe(true)
    const f = await fixture(raw, 'application/pdf')
    const before = await financialState(f)
    const response = await preview(f.order.id)
    expect(response.status).toBe(200)
    privateHeaders(response)
    expect(response.headers.get('content-type')).toMatch(/^application\/pdf(?:;|$)/)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    const bytes = Buffer.from(await response.arrayBuffer())
    const doc = await PDFDocument.load(bytes)
    expect(bytes.equals(raw)).toBe(false)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getPage(0).getSize()).toEqual(beforeDoc.getPage(0).getSize())
    expect(doc.getPage(0).node.has(PDFName.of('Contents'))).toBe(true)
    for (const key of ['OpenAction', 'AA', 'Names', 'AcroForm']) expect(doc.catalog.has(PDFName.of(key))).toBe(false)
    expect(doc.getPage(0).node.has(PDFName.of('AA'))).toBe(false)
    expect(doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0)
    expect(await financialState(f)).toEqual(before)
    await noLeaks(f, inspect([...response.headers]))
  }, 60_000)

  it.each(['missing-order', 'missing-key', 'unregistered-key', 'foreign-record', 'foreign-prefix', 'oversized-record', 'unsupported-mime'])(
    'rejects %s before storage access', async variant => {
      const f = await fixture()
      if (variant === 'missing-key') await testDb.order.update({ where: { id: f.order.id }, data: { proofKey: null } })
      if (variant === 'unregistered-key') await testDb.paymentProofUpload.delete({ where: { id: f.proof.id } })
      if (variant === 'foreign-record') {
        const other = await createEmployer(testDb)
        await testDb.paymentProofUpload.update({ where: { id: f.proof.id }, data: { companyId: other.companyId } })
      }
      if (variant === 'foreign-prefix') {
        const other = await createEmployer(testDb)
        const key = `payment_proofs/${other.companyId}/${randomUUID()}.png`
        await testDb.paymentProofUpload.update({ where: { id: f.proof.id }, data: { storageKey: key } })
        await testDb.order.update({ where: { id: f.order.id }, data: { proofKey: key } })
      }
      if (variant === 'oversized-record') await testDb.paymentProofUpload.update({ where: { id: f.proof.id }, data: { sizeBytes: MAX_PROOF_BYTES + 1 } })
      if (variant === 'unsupported-mime') await testDb.paymentProofUpload.update({ where: { id: f.proof.id }, data: { mimeType: 'text/html' } })
      const before = await financialState(f)
      await rejected(await preview(variant === 'missing-order' ? 'c' + '0'.repeat(24) : f.order.id), f)
      expect(io.read).not.toHaveBeenCalled()
      expect(await financialState(f)).toEqual(before)
    },
  )

  it('reads only the current order binding when another persistent upload exists', async () => {
    const f = await fixture()
    const stale = await testDb.paymentProofUpload.create({ data: {
      companyId: f.ctx.companyId, uploaderId: f.ctx.userId,
      storageKey: `payment_proofs/${f.ctx.companyId}/${randomUUID()}.png`,
      mimeType: 'image/png', sizeBytes: PROOF_BYTES.length,
    } })
    const response = await preview(f.order.id)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PROOF_BYTES)
    expect(io.read).toHaveBeenCalledTimes(1)
    expect(io.read.mock.calls[0][0]).toBe(f.proof.storageKey)
    expect(io.read.mock.calls[0][0]).not.toBe(stale.storageKey)
    await noLeaks(f)
  })

  it.each(['replaced-proof', 'removed-proof-record'])(
    'does not return stale bytes after %s during the read', async change => {
      const f = await fixture()
      io.read.mockImplementationOnce(async () => {
        if (change === 'replaced-proof') {
          const replacement = await testDb.paymentProofUpload.create({ data: {
            companyId: f.ctx.companyId, uploaderId: f.ctx.userId,
            storageKey: `payment_proofs/${f.ctx.companyId}/${randomUUID()}.png`,
            mimeType: 'image/png', sizeBytes: PROOF_BYTES.length,
          } })
          await testDb.order.update({ where: { id: f.order.id }, data: { proofKey: replacement.storageKey } })
        } else {
          await testDb.paymentProofUpload.delete({ where: { id: f.proof.id } })
        }
        return PROOF_BYTES
      })
      await rejected(await preview(f.order.id), f)
      expect(await testDb.creditLedger.count({ where: { refId: f.order.id } })).toBe(0)
      expect(await testDb.subscription.count({ where: { orderId: f.order.id } })).toBe(0)
    },
  )

  it.each(['storage-rejection', 'oversized-bytes', 'mime-mismatch', 'malformed-pdf'])(
    'fails closed for %s without logging receipt or bank data', async variant => {
      const f = await fixture()
      if (variant === 'storage-rejection') io.read.mockRejectedValueOnce(new Error(`S3 failed ${f.proof.storageKey} ${PRIVATE_CONTENT} ${Object.values(BANK).join(' ')}`))
      if (variant === 'oversized-bytes') io.read.mockResolvedValueOnce(Buffer.concat([PROOF_BYTES, Buffer.alloc(MAX_PROOF_BYTES)]))
      if (variant === 'mime-mismatch') io.read.mockResolvedValueOnce(await dangerousPdf())
      if (variant === 'malformed-pdf') {
        const malformed = Buffer.from('%PDF-1.7\n' + PRIVATE_CONTENT + '\n%%EOF')
        const key = f.proof.storageKey.replace(/\.png$/, '.pdf')
        await testDb.paymentProofUpload.update({ where: { id: f.proof.id }, data: { storageKey: key, mimeType: 'application/pdf', sizeBytes: malformed.length } })
        await testDb.order.update({ where: { id: f.order.id }, data: { proofKey: key } })
        f.proof.storageKey = key
        io.read.mockResolvedValueOnce(malformed)
      }
      const before = await financialState(f)
      await rejected(await preview(f.order.id), f, 'any')
      expect(await financialState(f)).toEqual(before)
    },
  )

  it('propagates request cancellation into the bounded object read and never delivers bytes', async () => {
    const f = await fixture()
    const requestAbort = new AbortController()
    let enter!: (signal: AbortSignal | undefined) => void
    let finish!: () => void
    const entered = new Promise<AbortSignal | undefined>(resolve => { enter = resolve })
    io.read.mockImplementationOnce((_key: string, opts?: { signal?: AbortSignal }) => new Promise<Buffer>((resolve, reject) => {
      enter(opts?.signal)
      finish = () => resolve(PROOF_BYTES)
      const abort = () => reject(Object.assign(new Error('Synthetic aborted read'), { name: 'AbortError' }))
      if (opts?.signal?.aborted) abort()
      else opts?.signal?.addEventListener('abort', abort, { once: true })
    }))
    const pending = preview(f.order.id, { signal: requestAbort.signal })
    try {
      const signal = await Promise.race([entered, pending.then(() => { throw new Error('Route ended before object read') })])
      expect(signal).toBeInstanceOf(AbortSignal)
      requestAbort.abort()
      expect(signal?.aborted).toBe(true)
      // If the signal is absent/miswired, the assertion throws and finally releases the mock.
      await rejected(await pending, f, 'any')
    } finally {
      finish?.()
      await pending
    }
  })
})
