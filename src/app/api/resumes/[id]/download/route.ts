import 'server-only'
import { z } from 'zod'
import { PDFDocument, StandardFonts, rgb, degrees, PDFName } from 'pdf-lib'
import { route } from '@/server/route'
import { ForbiddenError, NotFoundError, RateLimitedError } from '@/server/errors'
import { db } from '@/server/db'
import { canSeeIdentity } from '@/server/services/contact-access'
import { logAudit } from '@/server/services/audit'
import { getObjectBytes } from '@/lib/storage'
import { logger } from '@/server/lib/logger'

// Module-level in-process concurrent download limit per company member.
// Soft limit: resets on process restart. Max 2 concurrent watermark tasks per member.
const activeDownloads = new Map<string, number>()
const MAX_CONCURRENT_PER_MEMBER = 2

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

// Return the most printable ASCII label for the company (Helvetica is Latin-only).
// Decision: M4-T09 — pdf-lib standard fonts are WinAnsi (Latin-1 only); CJK characters
// require an embedded font. Until a font is added, ASCII-safe label is used.
function safeCompanyLabel(company: {
  id: string
  legalName: string
  displayNameEn: string | null
}): string {
  if (company.displayNameEn) return company.displayNameEn.slice(0, 50)
  if (/^[\x20-\x7E]*$/.test(company.legalName)) return company.legalName.slice(0, 50)
  return company.id
}

const idSchema = z.string().cuid()

export const GET = route({ auth: { type: 'company', verified: true } }, async (req, ctx) => {
  const userId = ctx.userId!
  const companyId = ctx.companyId!

  // Extract resume id: /api/resumes/{id}/download → second-to-last path segment
  const pathParts = new URL(req.url).pathname.split('/')
  const rawId = pathParts[pathParts.length - 2] ?? ''
  const parsed = idSchema.safeParse(rawId)
  if (!parsed.success) {
    return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    })
  }
  const resumeId = parsed.data

  // Load the resume record
  const resume = await db.resumeFile.findUnique({
    where: { id: resumeId },
    select: { id: true, storageKey: true, fileName: true, studentId: true },
  })
  if (!resume) {
    return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    })
  }

  // Check access: TalentUnlock must exist, student must not have blocked the company
  const canSee = await canSeeIdentity(companyId, resume.studentId)
  if (!canSee) {
    return new Response(JSON.stringify({ ok: false, code: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    })
  }

  // Enforce concurrent watermark task limit per company member
  if (!acquireSlot(userId)) {
    throw new RateLimitedError('Too many concurrent download requests')
  }

  try {
    // Load company info for watermark label
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { id: true, legalName: true, displayNameEn: true },
    })
    if (!company) throw new NotFoundError('Company not found')

    // Fetch raw PDF bytes from S3
    const pdfBytes = await getObjectBytes(resume.storageKey)

    // Rebuild PDF: create new document, copy pages (strips OpenAction, JavaScript, attachments)
    const sourceDoc = await PDFDocument.load(pdfBytes)
    const newDoc = await PDFDocument.create()
    const pageCount = sourceDoc.getPageCount()
    const pageIndices = Array.from({ length: pageCount }, (_, i) => i)
    const copiedPages = await newDoc.copyPages(sourceDoc, pageIndices)

    // Build watermark text (ASCII-safe; see DECISIONS M4-T09)
    const companyLabel = safeCompanyLabel(company)
    const dateStr = Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const watermarkText = `For ${companyLabel} only · ${dateStr} · ${userId}`

    const font = await newDoc.embedFont(StandardFonts.Helvetica)

    for (const page of copiedPages) {
      newDoc.addPage(page)
      const { width, height } = page.getSize()
      const fontSize = Math.max(8, Math.min(width, height) * 0.025)
      const textWidth = font.widthOfTextAtSize(watermarkText, fontSize)
      page.drawText(watermarkText, {
        x: (width - textWidth) / 2,
        y: height / 2,
        size: fontSize,
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity: 0.3,
        rotate: degrees(45),
      })
    }

    const outputBytes = await newDoc.save()

    // Verify output: no OpenAction, no JavaScript in Names
    const outputDoc = await PDFDocument.load(outputBytes)
    if (
      outputDoc.catalog.has(PDFName.of('OpenAction')) ||
      outputDoc.catalog.has(PDFName.of('Names'))
    ) {
      logger.error({ resumeId, companyId }, 'Watermarked PDF unexpectedly contains OpenAction or Names — blocking download')
      throw new ForbiddenError()
    }

    // Audit
    await logAudit({
      actorId: userId,
      action: 'resume.download',
      targetType: 'ResumeFile',
      targetId: resumeId,
      metadata: { companyId, studentId: resume.studentId },
    })

    return new Response(Buffer.from(outputBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="resume.pdf"',
        'Cache-Control': 'private, no-store',
      },
    })
  } finally {
    releaseSlot(userId)
  }
})
