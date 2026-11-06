import 'server-only'
import { PDFDocument } from 'pdf-lib'

// Magic bytes for supported file types
export const MAGIC_PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
export const MAGIC_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // PNG
export const MAGIC_JPEG = Buffer.from([0xff, 0xd8, 0xff]) // JPEG

export type AllowedMimeKey = 'pdf' | 'png' | 'jpeg'

export const MIME_TYPES: Record<AllowedMimeKey, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
}

/** Returns the detected file type from magic bytes, or null if not recognised. */
export function detectFileType(buf: Buffer): AllowedMimeKey | null {
  if (buf.length >= 5 && buf.subarray(0, 5).equals(MAGIC_PDF)) return 'pdf'
  if (buf.length >= 4 && buf.subarray(0, 4).equals(MAGIC_PNG)) return 'png'
  if (buf.length >= 3 && buf.subarray(0, 3).equals(MAGIC_JPEG)) return 'jpeg'
  return null
}

export type PdfCheckResult =
  | { ok: true; pageCount: number }
  | { ok: false; reason: 'parse_failed' | 'encrypted' | 'too_many_pages' }

/**
 * Parse the PDF buffer via pdf-lib and check for encryption and page limit.
 * Fail closed: any parse error returns reason='parse_failed' instead of allowing the file.
 */
export async function checkPdf(buf: Buffer, maxPages: number): Promise<PdfCheckResult> {
  let doc: PDFDocument
  try {
    // ignoreEncryption: true lets us load encrypted PDFs to inspect isEncrypted rather than throw
    doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })
  } catch {
    return { ok: false, reason: 'parse_failed' }
  }

  if (doc.isEncrypted) {
    return { ok: false, reason: 'encrypted' }
  }

  let pageCount: number
  try {
    pageCount = doc.getPageCount()
  } catch {
    return { ok: false, reason: 'parse_failed' }
  }

  if (pageCount > maxPages) {
    return { ok: false, reason: 'too_many_pages' }
  }

  return { ok: true, pageCount }
}
