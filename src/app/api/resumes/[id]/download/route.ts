import 'server-only'
import { z } from 'zod'
import { route } from '@/server/route'
import { NotFoundError, RateLimitedError } from '@/server/errors'
import { db } from '@/server/db'
import { identityAccess } from '@/server/services/contact-access'
import { logAudit } from '@/server/services/audit'
import { getObjectBytes } from '@/lib/storage'
import { getSetting } from '@/server/services/settings'
import { logger } from '@/server/lib/logger'
import { sanitizePdf } from '@/server/lib/pdf-sanitize'
import { watermarkPdf } from '@/server/lib/pdf-watermark'
import { RESUME_MAX_BYTES } from '@/server/lib/upload-constants'

// Module-level in-process concurrent download limits.
// Both limits are soft (reset on process restart).

const activeDownloads = new Map<string, number>()
const MAX_CONCURRENT_PER_MEMBER = 2

let activeGlobal = 0

function acquireSlot(userId: string): boolean {
  const current = activeDownloads.get(userId) ?? 0
  if (current >= MAX_CONCURRENT_PER_MEMBER) return false
  activeDownloads.set(userId, current + 1)
  return true
}

function releaseSlot(userId: string): void {
  const current = activeDownloads.get(userId) ?? 0
  if (current <= 1) activeDownloads.delete(userId)
  else activeDownloads.set(userId, current - 1)
}

async function acquireGlobalSlot(): Promise<boolean> {
  const max = await getSetting('resume.watermarkGlobalConcurrency', 4)
  if (activeGlobal >= max) return false
  activeGlobal++
  return true
}

function releaseGlobalSlot(): void {
  if (activeGlobal > 0) activeGlobal--
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

  // Load the resume record — include sizeBytes for pre-fetch size guard
  const resume = await db.resumeFile.findUnique({
    where: { id: resumeId },
    select: { id: true, storageKey: true, fileName: true, studentId: true, sizeBytes: true },
  })
  if (!resume) {
    return errorJson('NOT_FOUND', 404)
  }

  // Size guard: reject before fetching bytes if the stored size already exceeds the limit
  if (resume.sizeBytes > RESUME_MAX_BYTES) {
    logger.warn({ resumeId, sizeBytes: resume.sizeBytes }, 'resume sizeBytes exceeds limit — rejecting download')
    return errorJson('FILE_TOO_LARGE', 422)
  }

  // Access check: TalentUnlock must exist, student must not have blocked the company
  const access = await identityAccess(companyId, resume.studentId)
  if (access === 'gone') {
    return errorJson('NOT_FOUND', 404)
  }
  if (access === 'no_unlock') {
    return errorJson('FORBIDDEN', 403)
  }

  // Enforce concurrent watermark task limits (per-member and global)
  if (!acquireSlot(userId)) {
    throw new RateLimitedError('Too many concurrent download requests')
  }

  let globalAcquired = false
  try {
    globalAcquired = await acquireGlobalSlot()
    if (!globalAcquired) {
      throw new RateLimitedError('Server is busy — too many concurrent downloads')
    }

    // Load company info for watermark label
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { id: true, legalName: true, displayNameEn: true },
    })
    if (!company) throw new NotFoundError('Company not found')

    // Fetch raw PDF bytes from S3
    const pdfBytes = await getObjectBytes(resume.storageKey)

    // Sanitize: strip JS, macros, attachments, dangerous actions
    const sanitized = await sanitizePdf(pdfBytes)
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

    const watermarked = await watermarkPdf(sanitized.pdf, { text: watermarkText })
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

    return new Response(new Uint8Array(watermarked.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="resume.pdf"',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    })
  } finally {
    releaseSlot(userId)
    if (globalAcquired) releaseGlobalSlot()
  }
})
