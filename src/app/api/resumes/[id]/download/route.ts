import 'server-only'
import { z } from 'zod'
import { route } from '@/server/route'
import { NotFoundError, RateLimitedError } from '@/server/errors'
import { db } from '@/server/db'
import { identityAccess } from '@/server/services/contact-access'
import { logAudit } from '@/server/services/audit'
import { getObjectBytes } from '@/lib/storage'
import {
  acquireWatermarkLease,
  renewWatermarkLease,
  releaseWatermarkLease,
  type WatermarkLease,
} from '@/server/services/watermark-lease'
import { logger } from '@/server/lib/logger'
import { sanitizePdf } from '@/server/lib/pdf-sanitize'
import { watermarkPdf } from '@/server/lib/pdf-watermark'
import { RESUME_MAX_BYTES } from '@/server/lib/upload-constants'

const RENEW_INTERVAL_MS = 15_000
// Stop before the service's 60s DB lease expires, even if a renewal call hangs.
const SAFE_LEASE_DURATION_MS = 55_000
const STREAM_CHUNK_BYTES = 64 * 1024

function downloadAbortError(message: string): Error {
  return Object.assign(new Error(message), { name: 'AbortError' })
}

function keepLease(lease: WatermarkLease, requestSignal: AbortSignal, acquisitionStarted: number) {
  const abort = new AbortController()
  let renewalTimer: ReturnType<typeof setTimeout> | undefined
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let renewing: Promise<void> | undefined
  let finishing: Promise<void> | undefined
  let finished = false
  let expiresAt = acquisitionStarted + SAFE_LEASE_DURATION_MS

  const stopTimers = () => {
    clearTimeout(renewalTimer)
    clearTimeout(expiryTimer)
  }
  const onRequestAbort = () => abort.abort(downloadAbortError('Download request cancelled'))
  abort.signal.addEventListener('abort', stopTimers, { once: true })
  requestSignal.addEventListener('abort', onRequestAbort, { once: true })

  function setExpiry(started: number): void {
    clearTimeout(expiryTimer)
    expiresAt = started + SAFE_LEASE_DURATION_MS
    const remaining = expiresAt - performance.now()
    if (remaining <= 0) abort.abort(downloadAbortError('Watermark lease deadline elapsed'))
    else {
      expiryTimer = setTimeout(() => abort.abort(downloadAbortError('Watermark lease deadline elapsed')), remaining)
      expiryTimer.unref?.()
    }
  }

  function scheduleRenewal(): void {
    if (finished || abort.signal.aborted) return
    renewalTimer = setTimeout(() => {
      const started = performance.now()
      renewing = (async () => {
        try {
          const renewed = await renewWatermarkLease(lease)
          if (finished || abort.signal.aborted) return
          if (!renewed) abort.abort(downloadAbortError('Watermark lease lost'))
          else setExpiry(started)
        } catch (error) {
          logger.error({ leaseId: lease.id, err: error }, 'Watermark lease renewal failed')
          abort.abort(downloadAbortError('Watermark lease renewal failed'))
        } finally {
          renewing = undefined
          scheduleRenewal()
        }
      })()
    }, RENEW_INTERVAL_MS)
    renewalTimer.unref?.()
  }

  setExpiry(acquisitionStarted)
  if (requestSignal.aborted) onRequestAbort()
  scheduleRenewal()

  return {
    signal: abort.signal,
    throwIfAborted(): void {
      // Timers can be delayed by a busy event loop; recheck before starting work.
      if (performance.now() >= expiresAt) abort.abort(downloadAbortError('Watermark lease deadline elapsed'))
      abort.signal.throwIfAborted()
    },
    abort: () => abort.abort(downloadAbortError('Download stream cancelled')),
    finish(): Promise<void> {
      if (!finishing) {
        finished = true
        stopTimers()
        requestSignal.removeEventListener('abort', onRequestAbort)
        abort.signal.removeEventListener('abort', stopTimers)
        finishing = (async () => {
          // Do not allow a late renewal to race after the release.
          await renewing
          try {
            await releaseWatermarkLease(lease)
          } catch (error) {
            // The DB TTL recovers capacity if release is temporarily unavailable.
            logger.error({ leaseId: lease.id, err: error }, 'Watermark lease release failed')
          }
        })()
      }
      return finishing
    },
  }
}

// Return the most printable ASCII label for the company (Helvetica is Latin-only).
// Falls back to company.id when both legalName and displayNameEn contain non-ASCII.
function safeCompanyLabel(company: {
  id: string
  legalName: string
  displayNameEn: string | null
}): string {
  if (company.displayNameEn && /^[\x20-\x7E]*$/.test(company.displayNameEn)) {
    return company.displayNameEn.slice(0, 50)
  }
  if (/^[\x20-\x7E]*$/.test(company.legalName)) return company.legalName.slice(0, 50)
  return company.id
}

const idSchema = z.string().cuid()

function errorJson(code: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}

export const GET = route({ auth: { type: 'company', verified: true } }, async (req, ctx) => {
  const userId = ctx.userId!
  const companyId = ctx.companyId!

  // Extract resume id: /api/resumes/{id}/download → second-to-last path segment
  const pathParts = new URL(req.url).pathname.split('/')
  const rawId = pathParts[pathParts.length - 2] ?? ''
  const parsed = idSchema.safeParse(rawId)
  if (!parsed.success) {
    return errorJson('NOT_FOUND', 404)
  }
  const resumeId = parsed.data

  // Load the resume record — include sizeBytes for post-access size guard
  const resume = await db.resumeFile.findUnique({
    where: { id: resumeId },
    select: { id: true, storageKey: true, fileName: true, studentId: true, sizeBytes: true },
  })
  if (!resume) {
    return errorJson('NOT_FOUND', 404)
  }

  // Access check: TalentUnlock must exist, student must not have blocked the company
  // (checked before sizeBytes to avoid leaking file metadata to unverified callers)
  const access = await identityAccess(companyId, resume.studentId)
  if (access === 'gone') {
    return errorJson('NOT_FOUND', 404)
  }
  if (access === 'no_unlock') {
    return errorJson('FORBIDDEN', 403)
  }

  // Size guard: reject after access check so unlocked sizeBytes don't leak to unverified companies
  if (resume.sizeBytes > RESUME_MAX_BYTES) {
    logger.warn({ resumeId, sizeBytes: resume.sizeBytes }, 'resume sizeBytes exceeds limit — rejecting download')
    return errorJson('FILE_TOO_LARGE', 422)
  }

  req.signal.throwIfAborted()
  const acquireStarted = performance.now()
  const lease = await acquireWatermarkLease(userId)
  if (!lease) {
    throw new RateLimitedError('Too many concurrent download requests')
  }

  const lifetime = keepLease(lease, req.signal, acquireStarted)
  let streamOwnsLease = false
  try {
    lifetime.throwIfAborted()

    // Load company info for watermark label
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { id: true, legalName: true, displayNameEn: true },
    })
    if (!company) throw new NotFoundError('Company not found')
    lifetime.throwIfAborted()

    // Fetch raw PDF bytes from S3
    const pdfBytes = await getObjectBytes(resume.storageKey, {
      maxBytes: RESUME_MAX_BYTES,
      signal: lifetime.signal,
    })
    lifetime.throwIfAborted()

    // Sanitize: strip JS, macros, attachments, dangerous actions
    const sanitized = await sanitizePdf(pdfBytes, { signal: lifetime.signal })
    lifetime.throwIfAborted()
    if (!sanitized.ok) {
      logger.error({ resumeId, reason: sanitized.reason }, 'PDF sanitization failed — blocking download')
      if (sanitized.reason === 'too_large') return errorJson('FILE_TOO_LARGE', 422)
      return new Response(null, {
        status: 500,
        headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
      })
    }

    // Watermark: add diagonal label
    const companyLabel = safeCompanyLabel(company)
    const dateStr = Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const watermarkText = `For ${companyLabel} only · ${dateStr} · ${userId}`

    const watermarked = await watermarkPdf(sanitized.pdf, { text: watermarkText }, { signal: lifetime.signal })
    lifetime.throwIfAborted()
    if (!watermarked.ok) {
      logger.error({ resumeId, reason: watermarked.reason }, 'PDF watermark failed — blocking download')
      if (watermarked.reason === 'too_large') return errorJson('FILE_TOO_LARGE', 422)
      return new Response(null, {
        status: 500,
        headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
      })
    }

    // Audit
    await logAudit({
      actorId: userId,
      action: 'resume.download',
      targetType: 'ResumeFile',
      targetId: resumeId,
      metadata: { companyId, studentId: resume.studentId },
    })
    lifetime.throwIfAborted()

    // pdf-lib still needs bounded complete PDFs. The response yields views of its
    // completed output without another full copy, and retains the lease through EOF.
    const output = watermarked.pdf
    let offset = 0
    let ended = false
    let cancelled = false
    let streamController: ReadableStreamDefaultController<Uint8Array>
    const onAbort = () => {
      if (ended) return
      ended = true
      streamController.error(lifetime.signal.reason)
      void lifetime.finish()
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        lifetime.signal.addEventListener('abort', onAbort, { once: true })
      },
      async pull(controller) {
        if (ended) return
        try {
          lifetime.throwIfAborted()
          if (offset >= output.byteLength) {
            ended = true
            lifetime.signal.removeEventListener('abort', onAbort)
            await lifetime.finish()
            if (!cancelled) controller.close()
            return
          }
          const next = Math.min(offset + STREAM_CHUNK_BYTES, output.byteLength)
          controller.enqueue(output.subarray(offset, next))
          offset = next
        } catch (error) {
          ended = true
          lifetime.signal.removeEventListener('abort', onAbort)
          await lifetime.finish()
          if (!cancelled) controller.error(error)
        }
      },
      async cancel() {
        cancelled = true
        ended = true
        lifetime.signal.removeEventListener('abort', onAbort)
        lifetime.abort()
        await lifetime.finish()
      },
    }, { highWaterMark: 0 })
    const response = new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="resume.pdf"',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    })
    streamOwnsLease = true
    return response
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'FILE_TOO_LARGE') {
      return errorJson('FILE_TOO_LARGE', 422)
    }
    throw error
  } finally {
    // Awaited storage/worker operations have stopped before this point. A response
    // stream takes over cleanup only after it has been constructed successfully.
    if (!streamOwnsLease) await lifetime.finish()
  }
})
