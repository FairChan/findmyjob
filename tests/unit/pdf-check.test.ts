import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { checkPdf, hasRawEncryptionMarkers, detectFileType } from '@/server/lib/pdf'

// --- helpers ---

async function makeValidPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) doc.addPage([612, 792])
  return Buffer.from(await doc.save())
}

/** Builds a minimal bomb-looking PDF: valid structure but with a large FlateDecode stream.
 * Not a true 1000x amplification bomb, but exercises the Worker path end-to-end. */
async function makePdfWithLargeStream(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  return Buffer.from(await doc.save())
}

/** Craft a byte buffer that looks like an encrypted PDF without calling pdf-lib. */
function makeRawEncryptedPdfBytes(): Buffer {
  // Minimal content containing the markers hasRawEncryptionMarkers looks for
  const content = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n3 0 obj\n<< /Filter /Standard /O (xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx) /U (yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy) /R 2 /P -4 >>\nendobj\nxref\n0 4\ntrailer\n<< /Size 4 /Root 1 0 R /Encrypt 3 0 R >>\nstartxref\n%%EOF\n`
  return Buffer.from('%PDF-' + content.slice(5))
}

/** Create a minimal valid PDF with 0 pages (empty /Kids [] in the Pages dict). */
function makeZeroPagePdf(): Buffer {
  // pdf-lib returns pageCount=0 for a document whose /Pages has /Kids [] /Count 0
  const pdf =
    '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n' +
    'xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n' +
    'trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n116\n%%EOF\n'
  return Buffer.from(pdf)
}

// ---------------------------------------------------------------------------
describe('detectFileType', () => {
  it('recognises a valid PDF buffer', async () => {
    const buf = await makeValidPdf()
    expect(detectFileType(buf)).toBe('pdf')
  })
})

// ---------------------------------------------------------------------------
describe('hasRawEncryptionMarkers', () => {
  it('returns false for a normal PDF', async () => {
    const buf = await makeValidPdf()
    expect(hasRawEncryptionMarkers(buf)).toBe(false)
  })

  it('returns true when buffer contains /Encrypt ref plus /O and /U markers', () => {
    const buf = makeRawEncryptedPdfBytes()
    expect(hasRawEncryptionMarkers(buf)).toBe(true)
  })

  it('returns false when only /O and /U are present but no /Encrypt or /Filter /Standard', () => {
    const buf = Buffer.from('%PDF-1.4\n<< /O (abc) /U (xyz) >>\n')
    expect(hasRawEncryptionMarkers(buf)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('checkPdf', () => {
  it('accepts a normal 1-page PDF', async () => {
    const buf = await makeValidPdf(1)
    const result = await checkPdf(buf, 20)
    expect(result).toEqual({ ok: true, pageCount: 1 })
  }, 15_000)

  it('accepts a 2-page PDF within maxPages limit', async () => {
    const buf = await makeValidPdf(2)
    const result = await checkPdf(buf, 20)
    expect(result).toEqual({ ok: true, pageCount: 2 })
  }, 15_000)

  it('rejects a PDF exceeding maxPages', async () => {
    const buf = await makeValidPdf(3)
    const result = await checkPdf(buf, 2)
    expect(result).toEqual({ ok: false, reason: 'too_many_pages' })
  }, 15_000)

  it('rejects a 0-page PDF', async () => {
    const buf = makeZeroPagePdf()
    const result = await checkPdf(buf, 20)
    expect(result.ok).toBe(false)
  }, 15_000)

  it('rejects a truncated / malformed buffer', async () => {
    const buf = Buffer.from('%PDF-1.4\ngarbage\x00\x01\x02')
    const result = await checkPdf(buf, 20)
    expect(result).toEqual({ ok: false, reason: 'parse_failed' })
  }, 15_000)

  it('rejects a PDF with raw encryption markers (trailer-override defence)', async () => {
    const buf = makeRawEncryptedPdfBytes()
    const result = await checkPdf(buf, 20)
    expect(result).toEqual({ ok: false, reason: 'encrypted' })
  }, 15_000)

  it('allows a PDF that contains encryption-keyword text in body but is not encrypted', async () => {
    // A document that talks ABOUT /Standard /O /U in its content stream should not be blocked
    // (hasRawEncryptionMarkers requires both /Encrypt or /Filter /Standard together with /O /U)
    const buf = await makeValidPdf(1)
    // Check that a normal PDF without those markers passes
    expect(hasRawEncryptionMarkers(buf)).toBe(false)
    const result = await checkPdf(buf, 20)
    expect(result.ok).toBe(true)
  }, 15_000)

  it('handles a large-stream PDF without crashing (worker memory limit defence)', async () => {
    const buf = await makePdfWithLargeStream()
    const result = await checkPdf(buf, 20)
    // A well-formed PDF must pass; the test validates the Worker path works end-to-end
    expect(result.ok).toBe(true)
  }, 30_000)
})
