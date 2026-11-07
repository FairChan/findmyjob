import { z } from 'zod'
import { S3Client, GetObjectCommand, type GetObjectCommandOutput } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import { env } from '@/env'
import { db } from '@/server/db'
import { logAudit } from '@/server/services/audit'
import { route } from '@/server/route'

const verificationIdSchema = z.string().cuid()
const indexSchema = z.coerce.number().int().nonnegative()

function encodeRfc5987(str: string): string {
  return (
    "UTF-8''" +
    encodeURIComponent(str).replace(
      /[!'()]/g,
      c => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
    )
  )
}

export const GET = route({ auth: 'admin' }, async (req, ctx) => {
  const parts = new URL(req.url).pathname.split('/')
  const rawVerificationId = parts[parts.length - 2] ?? ''
  const rawIndex = parts[parts.length - 1] ?? ''

  const verificationIdResult = verificationIdSchema.safeParse(rawVerificationId)
  const indexResult = indexSchema.safeParse(rawIndex)

  if (!verificationIdResult.success || !indexResult.success) {
    return new Response(null, {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  const verificationId = verificationIdResult.data
  const index = indexResult.data

  const cv = await db.companyVerification.findUnique({
    where: { id: verificationId },
    select: { id: true, companyId: true, documentKeys: true },
  })

  if (!cv || index >= cv.documentKeys.length) {
    return new Response(null, {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  const key = cv.documentKeys[index]

  await logAudit({
    actorId: ctx.userId!,
    action: 'company.verification.doc_view',
    targetType: 'Company',
    targetId: cv.companyId,
    metadata: { verificationId, index },
  })

  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  })

  let s3Response: GetObjectCommandOutput
  try {
    s3Response = await client.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    )
  } catch {
    return new Response(null, {
      status: 502,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  const rawBody = s3Response.Body
  if (!rawBody) {
    return new Response(null, {
      status: 502,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  // Size guard: verification docs are capped at 10 MB at upload time; refuse to proxy oversized objects
  const VERIFICATION_MAX_BYTES = 10 * 1024 * 1024
  if (s3Response.ContentLength != null && s3Response.ContentLength > VERIFICATION_MAX_BYTES) {
    return new Response(null, {
      status: 502,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  const fileName = key.split('/').pop() ?? `document-${index + 1}`
  const responseHeaders = new Headers({
    'Content-Type': s3Response.ContentType ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=${encodeRfc5987(fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex',
  })
  if (s3Response.ContentLength != null) {
    responseHeaders.set('Content-Length', String(s3Response.ContentLength))
  }

  const webStream = Readable.toWeb(rawBody as Readable) as ReadableStream<Uint8Array>

  // When S3 omits ContentLength (e.g. chunked encoding), guard with a byte counter.
  // Headers are already committed at this point, so exceeding the limit closes the stream
  // rather than returning 502; that is acceptable fail-closed behaviour.
  let streamTotal = 0
  const sizeGuard = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      streamTotal += chunk.byteLength
      if (streamTotal > VERIFICATION_MAX_BYTES) {
        controller.error(new Error('oversized'))
        return
      }
      controller.enqueue(chunk)
    },
  })

  return new Response(webStream.pipeThrough(sizeGuard), { status: 200, headers: responseHeaders })
})
