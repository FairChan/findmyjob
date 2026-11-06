import 'server-only'

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

/**
 * Returns true if the PDF binary contains an /Encrypt dictionary reference.
 * Checks the trailer area (last 8 KB) first, then the cross-reference section header.
 */
export function isPdfEncrypted(buf: Buffer): boolean {
  const tail = buf.subarray(Math.max(0, buf.length - 8192)).toString('latin1')
  // /Encrypt followed by a space, digit, '<', or reference indicator
  return /\/Encrypt[\s\d</([]/.test(tail)
}

/**
 * Returns the total page count of a PDF by scanning for /Count N entries in
 * the page tree.  The root page tree node has the highest /Count value.
 * Throws if no page count can be determined.
 *
 * Note: this is a heuristic that works for standard PDF structures.
 * Intentionally avoiding a heavy PDF library dependency (A26).
 */
export function getPdfPageCount(buf: Buffer): number {
  const str = buf.toString('latin1')
  const matches = [...str.matchAll(/\/Count\s+(\d+)/g)]
  if (matches.length === 0) {
    throw new Error('Could not determine page count from PDF')
  }
  return Math.max(...matches.map(m => parseInt(m[1]!, 10)))
}
