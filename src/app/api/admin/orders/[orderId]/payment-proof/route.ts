import { z } from 'zod'
import { route } from '@/server/route'
import { AppError, ForbiddenError, NotFoundError } from '@/server/errors'
import { requireAdmin } from '@/server/authz'
import { db } from '@/server/db'
import { getObjectBytes } from '@/lib/storage'
import { detectFileType, MIME_TYPES } from '@/server/lib/pdf'
import { sanitizePdf } from '@/server/lib/pdf-sanitize'
import { logAudit } from '@/server/services/audit'

const MAX_BYTES = 10 * 1024 * 1024
const orderIdSchema = z.string().cuid()
const filePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg)$/

function unavailable() {
  return new AppError('Payment proof is unavailable', 'PAYMENT_PROOF_UNAVAILABLE', 502)
}

async function boundProof(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId }, select: { companyId: true, proofKey: true },
  })
  if (!order?.proofKey) throw new NotFoundError()
  const parts = order.proofKey.split('/')
  if (parts.length !== 3 || parts[0] !== 'payment_proofs' || parts[1] !== order.companyId || !filePattern.test(parts[2])) {
    throw new NotFoundError()
  }
  const proof = await db.paymentProofUpload.findUnique({
    where: { storageKey: order.proofKey },
    select: { id: true, companyId: true, storageKey: true, mimeType: true, sizeBytes: true },
  })
  if (!proof || proof.companyId !== order.companyId || proof.sizeBytes < 1 || proof.sizeBytes > MAX_BYTES
    || !Object.values(MIME_TYPES).includes(proof.mimeType)) throw new NotFoundError()
  return proof
}

export const GET = route({ auth: 'admin-fresh' }, async (req, ctx) => {
  const parts = new URL(req.url).pathname.split('/')
  const parsed = orderIdSchema.safeParse(parts.at(-2))
  if (!parsed.success) throw new NotFoundError()
  const orderId = parsed.data
  const proof = await boundProof(orderId)
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(20_000)])
  if (signal.aborted) throw unavailable()

  let bytes: Buffer
  try {
    bytes = await getObjectBytes(proof.storageKey, { maxBytes: MAX_BYTES, signal })
  } catch {
    // Storage failures may contain private object paths or file content.
    throw unavailable()
  }
  if (signal.aborted) throw unavailable()
  const type = detectFileType(bytes)
  const extension = proof.storageKey.split('.').at(-1)
  if (bytes.length !== proof.sizeBytes || bytes.length > MAX_BYTES || !type
    || MIME_TYPES[type] !== proof.mimeType || extension !== (type === 'jpeg' ? 'jpg' : type)) {
    throw new AppError('Invalid payment proof', 'INVALID_PAYMENT_PROOF', 422)
  }
  if (type === 'pdf') {
    const sanitized = await sanitizePdf(bytes, { signal })
    if (!sanitized.ok) throw new AppError('Invalid payment proof', 'INVALID_PAYMENT_PROOF', 422)
    bytes = sanitized.pdf
  }
  if (signal.aborted) throw unavailable()

  // Object IO and PDF processing happen outside a database transaction. Recheck
  // both the session and the exact persisted binding before releasing bytes.
  const currentAdmin = await requireAdmin(req.headers, { fresh: true })
  if (currentAdmin.userId !== ctx.userId) throw new ForbiddenError()
  const current = await boundProof(orderId)
  if (current.id !== proof.id || current.companyId !== proof.companyId || current.storageKey !== proof.storageKey
    || current.mimeType !== proof.mimeType || current.sizeBytes !== proof.sizeBytes) throw new NotFoundError()
  if (signal.aborted) throw unavailable()
  await logAudit({
    actorId: ctx.userId!, action: 'order.proof.view', targetType: 'Order', targetId: orderId,
    metadata: { companyId: proof.companyId },
  })
  if (signal.aborted) throw unavailable()
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': MIME_TYPES[type],
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="payment-proof.${extension}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    },
  })
})
