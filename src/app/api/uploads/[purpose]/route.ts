import { randomUUID } from 'crypto'
import { route } from '@/server/route'
import { checkRateLimit } from '@/server/lib/rate-limit'
import { logAudit } from '@/server/services/audit'
import { getSetting } from '@/server/services/settings'
import { assertUploadsEnabled } from '@/server/services/feature-flags'
import { putObject } from '@/lib/storage'
import { detectFileType, isPdfEncrypted, getPdfPageCount, MIME_TYPES } from '@/server/lib/pdf'
import { db } from '@/server/db'
import type { AllowedMimeKey } from '@/server/lib/pdf'

type UploadPurpose = 'RESUME' | 'VERIFICATION' | 'PAYMENT_PROOF' | 'LOGO'

const VALID_PURPOSES = new Set<string>(['RESUME', 'VERIFICATION', 'PAYMENT_PROOF', 'LOGO'])

interface PurposeConfig {
  types: AllowedMimeKey[]
  maxBytes: number
}

const PURPOSE_CONFIGS: Record<UploadPurpose, PurposeConfig> = {
  RESUME: { types: ['pdf'], maxBytes: 5 * 1024 * 1024 },
  VERIFICATION: { types: ['pdf', 'png', 'jpeg'], maxBytes: 10 * 1024 * 1024 },
  PAYMENT_PROOF: { types: ['pdf', 'png', 'jpeg'], maxBytes: 10 * 1024 * 1024 },
  LOGO: { types: ['png', 'jpeg'], maxBytes: 2 * 1024 * 1024 },
}

const EXT: Record<AllowedMimeKey, string> = { pdf: 'pdf', png: 'png', jpeg: 'jpg' }

function rejectJson(code: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  })
}

// Note: this route handler reads formData directly (no route() input schema),
// because route()'s input parsing only handles JSON bodies.
export const POST = route({ auth: 'student' }, async (req, ctx) => {
  await assertUploadsEnabled()

  const userId = ctx.userId!

  // Extract purpose from URL path (e.g. /api/uploads/RESUME)
  const rawPurpose = new URL(req.url).pathname.split('/').pop()?.toUpperCase() ?? ''
  if (!VALID_PURPOSES.has(rawPurpose)) {
    return rejectJson('NOT_FOUND', 404)
  }
  const purpose = rawPurpose as UploadPurpose
  const config = PURPOSE_CONFIGS[purpose]

  // Per-user hourly upload rate limit
  const uploadsPerHour = await getSetting<number>('limits.uploadsPerHour', 20)
  const rl = await checkRateLimit(`upload:${userId}`, {
    windowMs: 60 * 60 * 1000,
    limit: uploadsPerHour,
  })
  if (!rl.allowed) {
    await logAudit({
      actorId: userId,
      action: 'upload.reject',
      targetType: 'Upload',
      metadata: { reason: 'rate_limit', purpose },
    })
    return rejectJson('RATE_LIMITED', 429)
  }

  // Parse multipart form data
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return rejectJson('INVALID_REQUEST', 400)
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return rejectJson('NO_FILE', 400)
  }

  // Size check (before reading full buffer)
  if (file.size > config.maxBytes) {
    await logAudit({
      actorId: userId,
      action: 'upload.reject',
      targetType: 'Upload',
      metadata: { reason: 'size_exceeded', sizeBytes: file.size, purpose },
    })
    return rejectJson('FILE_TOO_LARGE', 413)
  }

  const buf = Buffer.from(await file.arrayBuffer())

  // File header (magic bytes) check
  const detectedType = detectFileType(buf)
  if (!detectedType || !config.types.includes(detectedType)) {
    await logAudit({
      actorId: userId,
      action: 'upload.reject',
      targetType: 'Upload',
      metadata: { reason: 'invalid_type', detectedType: detectedType ?? 'unknown', purpose },
    })
    return rejectJson('INVALID_FILE_TYPE', 400)
  }

  // PDF-specific checks
  let pageCount: number | undefined
  if (detectedType === 'pdf') {
    if (isPdfEncrypted(buf)) {
      await logAudit({
        actorId: userId,
        action: 'upload.reject',
        targetType: 'Upload',
        metadata: { reason: 'encrypted_pdf', purpose },
      })
      return rejectJson('ENCRYPTED_PDF', 400)
    }

    if (purpose === 'RESUME') {
      const maxPages = await getSetting<number>('resume.maxPages', 20)
      let counted: number
      try {
        counted = getPdfPageCount(buf)
      } catch {
        counted = 1 // If we can't determine page count, allow it and store null
      }
      if (counted > maxPages) {
        await logAudit({
          actorId: userId,
          action: 'upload.reject',
          targetType: 'Upload',
          metadata: { reason: 'page_limit_exceeded', pageCount: counted, maxPages, purpose },
        })
        return rejectJson('TOO_MANY_PAGES', 400)
      }
      pageCount = counted
    }
  }

  // Server-generated object key (never trust client input for path)
  const key = `${purpose.toLowerCase()}/${userId}/${randomUUID()}.${EXT[detectedType]}`

  // All checks passed — upload to object storage
  await putObject(key, buf, MIME_TYPES[detectedType])

  // For RESUME purpose: create or update ResumeFile record
  if (purpose === 'RESUME') {
    const profile = await db.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    })
    if (!profile) {
      return rejectJson('NOT_FOUND', 404)
    }

    const resume = await db.resumeFile.create({
      data: {
        studentId: profile.id,
        storageKey: key,
        fileName: file.name,
        mimeType: MIME_TYPES[detectedType],
        sizeBytes: file.size,
        pageCount: pageCount ?? null,
        isPrimary: false,
      },
    })

    return Response.json({ ok: true, key, resumeId: resume.id })
  }

  return Response.json({ ok: true, key })
})
