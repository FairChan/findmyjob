import { randomUUID } from 'crypto'
import { z } from 'zod'
import { route } from '@/server/route'
import { checkRateLimit } from '@/server/lib/rate-limit'
import { logAudit } from '@/server/services/audit'
import { getSetting } from '@/server/services/settings'
import { assertUploadsEnabled } from '@/server/services/feature-flags'
import { putObject } from '@/lib/storage'
import { detectFileType, checkPdf, MIME_TYPES } from '@/server/lib/pdf'
import { db } from '@/server/db'
import type { AllowedMimeKey } from '@/server/lib/pdf'

type UploadPurpose = 'RESUME' | 'VERIFICATION' | 'PAYMENT_PROOF' | 'LOGO'

const purposeSchema = z.enum(['RESUME', 'VERIFICATION', 'PAYMENT_PROOF', 'LOGO'])

// Bidi and invisible control characters that must not appear in stored filenames
const BIDI_RE = /[‪-‮⁦-⁩\u0000-\u001f\u007f]/g

function sanitizeFileName(raw: string): string {
  return raw.replace(BIDI_RE, '').trim().slice(0, 255) || 'upload'
}

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
// auth:'user' is the minimum check; purpose-specific role checks happen below.
export const POST = route({ auth: 'user' }, async (req, ctx) => {
  await assertUploadsEnabled()

  const userId = ctx.userId!

  // Extract and validate purpose from URL path (e.g. /api/uploads/RESUME)
  const rawPurpose = new URL(req.url).pathname.split('/').pop()?.toUpperCase() ?? ''
  const parsedPurpose = purposeSchema.safeParse(rawPurpose)
  if (!parsedPurpose.success) {
    return rejectJson('NOT_FOUND', 404)
  }
  const purpose = parsedPurpose.data
  const config = PURPOSE_CONFIGS[purpose]

  // Purpose-specific role checks
  let companyId: string | undefined
  if (purpose === 'RESUME') {
    const { requireStudent } = await import('@/server/authz')
    try {
      await requireStudent(req.headers as unknown as Headers)
    } catch {
      return rejectJson('FORBIDDEN', 403)
    }
  } else if (purpose === 'LOGO' || purpose === 'VERIFICATION' || purpose === 'PAYMENT_PROOF') {
    const { requireCompanyMember } = await import('@/server/authz')
    try {
      const companyCtx = await requireCompanyMember('ADMIN', req.headers as unknown as Headers)
      companyId = companyCtx.companyId
    } catch {
      return rejectJson('FORBIDDEN', 403)
    }
  }

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

  // PDF-specific checks (fail closed: parse errors are rejected)
  let pageCount: number | undefined
  if (detectedType === 'pdf') {
    const maxPages = purpose === 'RESUME' ? await getSetting<number>('resume.maxPages', 20) : 9999
    const pdfResult = await checkPdf(buf, maxPages)
    if (!pdfResult.ok) {
      await logAudit({
        actorId: userId,
        action: 'upload.reject',
        targetType: 'Upload',
        metadata: { reason: pdfResult.reason, purpose },
      })
      return rejectJson(
        pdfResult.reason === 'encrypted'
          ? 'ENCRYPTED_PDF'
          : pdfResult.reason === 'too_many_pages'
            ? 'TOO_MANY_PAGES'
            : 'INVALID_PDF',
        400,
      )
    }
    if (purpose === 'RESUME') {
      pageCount = pdfResult.pageCount
    }
  }

  // Server-generated object key (never trust client input for path)
  // Key rules: resumes/{userId}/, logos/{companyId}/, verifications/{companyId}/
  let key: string
  if ((purpose === 'LOGO' || purpose === 'VERIFICATION' || purpose === 'PAYMENT_PROOF') && companyId) {
    const folder = purpose === 'LOGO' ? 'logos' : purpose === 'VERIFICATION' ? 'verifications' : 'payment_proofs'
    key = `${folder}/${companyId}/${randomUUID()}.${EXT[detectedType]}`
  } else {
    key = `${purpose.toLowerCase()}s/${userId}/${randomUUID()}.${EXT[detectedType]}`
  }

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

    const safeFileName = sanitizeFileName(file.name)
    const resume = await db.resumeFile.create({
      data: {
        studentId: profile.id,
        storageKey: key,
        fileName: safeFileName,
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
