import { vi, describe, it, expect, beforeEach } from 'vitest'
import zlib from 'node:zlib'
import { PDFDocument } from 'pdf-lib'

// ---------------------------------------------------------------------------
// Helpers for bypass-coverage tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal PDF-1.5 where startxref points to an XRef stream object.
 * pdf-lib MUST decompress the XRef stream to load the document, so the
 * ensureBuffer patch intercepts any inflate bomb in the stream data.
 *
 * @param dictExtra  Additional key-value tokens inserted into the stream dict.
 *                   Use this to inject the bypass filter spec.
 * @param streamData Already-compressed bytes that become the XRef stream body.
 * @param noNewlineAfterStream  When true, omit the \n between "stream" and data
 *                              (bypass #6: pre-scan skips streams without newline).
 */
function buildXRefBombPdf(
  dictExtra: string,
  streamData: Buffer,
  noNewlineAfterStream = false,
): Buffer {
  const header = Buffer.from('%PDF-1.5\n')
  // Object 9 placed first so pdf-lib can resolve "9 0 R" indirect references
  // that appear in the XRef stream dict (bypass #1).
  const obj9 = Buffer.from('9 0 obj\n/FlateDecode\nendobj\n')
  const sep = noNewlineAfterStream ? '' : '\n'
  const xrefHdr = Buffer.from(
    `99 0 obj\n<< /Type /XRef /Size 100 /W [1 2 1] /Length ${streamData.length} ${dictExtra} >>\nstream${sep}`,
  )
  const xrefFtr = Buffer.from('\nendstream\nendobj\n')
  const xrefOffset = header.length + obj9.length
  const trailerBuf = Buffer.from(`startxref\n${xrefOffset}\n%%EOF\n`)
  return Buffer.concat([header, obj9, xrefHdr, streamData, xrefFtr, trailerBuf])
}

/** Craft a valid zlib stream: stored-block (BFINAL=0, content="endstream") followed
 *  by a raw-deflate bomb block (BFINAL=1).  The literal bytes "endstream" inside
 *  the stored block fool indexOf-based pre-scan into truncating too early. */
function makeStoredBlockBomb(bombBytes: number): Buffer {
  // zlib header: CMF=0x78 (deflate, 32 KB window), FLG=0x01
  // Validity check: (0x78 << 8 | 0x01) = 30721, 30721 % 31 == 0  ✓
  const zlibHeader = Buffer.from([0x78, 0x01])
  // Stored block header: BFINAL=0, BTYPE=00 → byte=0x00; LEN=9, NLEN=~9=0xFFF6
  const storedHdr = Buffer.from([0x00, 0x09, 0x00, 0xf6, 0xff])
  const storedContent = Buffer.from('endstream') // 9 bytes – the literal that fools indexOf
  // Bomb block: raw deflate with BFINAL=1 (last block)
  const bombRaw = zlib.deflateRawSync(Buffer.alloc(bombBytes))
  // Fake Adler-32 trailer – FlateStream does not verify it
  const fakeAdler = Buffer.from([0x00, 0x00, 0x00, 0x00])
  return Buffer.concat([zlibHeader, storedHdr, storedContent, bombRaw, fakeAdler])
}

// Must be hoisted so the mock is in place before pdf.ts is imported
const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

import { checkPdf, checkInflateBomb, hasRawEncryptionMarkers, detectFileType } from '@/server/lib/pdf'

// --- helpers ---

async function makeValidPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) doc.addPage([612, 792])
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

// Default: 50 MB budget so normal PDFs are not rejected; individual tests override as needed
beforeEach(() => {
  mockGetSetting.mockResolvedValue(50 * 1024 * 1024)
})

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

  it('rejects a FlateDecode decompression bomb before entering the worker', async () => {
    // Compress 3 MB of zeros → ~3 KB compressed; inflates to 3 MB > 2 MB limit
    const LIMIT = 2 * 1024 * 1024
    mockGetSetting.mockResolvedValue(LIMIT)

    const compressed = zlib.deflateSync(Buffer.alloc(3 * 1024 * 1024))
    const realPdf = await makeValidPdf(1)
    const bombSuffix = Buffer.concat([
      Buffer.from(`\n9999 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream\nendobj\n'),
    ])
    const result = await checkPdf(Buffer.concat([realPdf, bombSuffix]), 20)
    expect(result).toEqual({ ok: false, reason: 'parse_failed' })
  }, 10_000)
})

// ---------------------------------------------------------------------------
describe('checkInflateBomb', () => {
  it('returns false for a buffer with no FlateDecode streams', () => {
    const buf = Buffer.from('%PDF-1.4\nno streams here')
    expect(checkInflateBomb(buf, 10 * 1024 * 1024)).toBe(false)
  })

  it('returns false for a small FlateDecode stream within budget', () => {
    const small = Buffer.from('Hello PDF content')
    const compressed = zlib.deflateSync(small)
    const buf = Buffer.concat([
      Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream\nendobj\n'),
    ])
    expect(checkInflateBomb(buf, 10 * 1024 * 1024)).toBe(false)
  })

  it('returns true when a single FlateDecode stream inflates beyond budget', () => {
    // 3 MB of zeros → ~3 KB compressed; inflates to 3 MB > 2 MB limit
    const compressed = zlib.deflateSync(Buffer.alloc(3 * 1024 * 1024))
    const buf = Buffer.concat([
      Buffer.from(`1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream\nendobj\n'),
    ])
    expect(checkInflateBomb(buf, 2 * 1024 * 1024)).toBe(true)
  })

  it('returns true when cumulative inflation from multiple streams exceeds budget', () => {
    // Two streams, each inflating to 1.5 MB; total 3 MB > 2 MB budget
    const half = zlib.deflateSync(Buffer.alloc(1.5 * 1024 * 1024))
    const streamChunk = (data: Buffer) =>
      Buffer.concat([
        Buffer.from(`<< /Filter /FlateDecode /Length ${data.length} >>\nstream\n`),
        data,
        Buffer.from('\nendstream\n'),
      ])
    const buf = Buffer.concat([streamChunk(half), streamChunk(half)])
    expect(checkInflateBomb(buf, 2 * 1024 * 1024)).toBe(true)
  })

  it('ignores non-FlateDecode streams', () => {
    // A stream with /DCTDecode (JPEG) should not be inflated
    const junk = Buffer.alloc(100, 0xff)
    const buf = Buffer.concat([
      Buffer.from(`1 0 obj\n<< /Length ${junk.length} /Filter /DCTDecode >>\nstream\n`),
      junk,
      Buffer.from('\nendstream\nendobj\n'),
    ])
    // Should not throw even though the data is not valid zlib
    expect(checkInflateBomb(buf, 1 * 1024)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Bypass coverage: each test demonstrates one technique that fools the
// checkInflateBomb pre-scan; checkPdf must still reject via the worker's
// ensureBuffer patch (or via a parse error – both are fail-closed).
//
// Verification step (manual, not committed):
//   Temporarily remove the `DecodeStream.prototype.ensureBuffer = ...` patch
//   from PDF_WORKER_CODE in pdf.ts, then re-run this suite.  At least tests
//   bypass-3, bypass-4, bypass-5 should take ~10 s (worker timeout) or OOM,
//   confirming that the patch is the definitive defence for those cases.
// ---------------------------------------------------------------------------
describe('checkPdf bypass coverage', () => {
  const LIMIT = 1 * 1024 * 1024 // 1 MB – tight budget to keep tests fast

  beforeEach(() => {
    mockGetSetting.mockResolvedValue(LIMIT)
  })

  // --- control group: normal PDFs still pass ---

  it('ctrl: accepts a normal 1-page PDF within budget', async () => {
    const buf = await makeValidPdf(1)
    const result = await checkPdf(buf, 20)
    expect(result).toEqual({ ok: true, pageCount: 1 })
  }, 15_000)

  it('ctrl: accepts a normal 2-page PDF within budget', async () => {
    const buf = await makeValidPdf(2)
    const result = await checkPdf(buf, 20)
    expect(result).toEqual({ ok: true, pageCount: 2 })
  }, 15_000)

  it('ctrl: accepts a PDF with FlateDecode content stream within budget', async () => {
    // Append a dead FlateDecode stream within budget; pre-scan and worker both pass.
    const small = zlib.deflateSync(Buffer.alloc(LIMIT / 4)) // well under 1 MB
    const base = await makeValidPdf(1)
    const suffix = Buffer.concat([
      Buffer.from(`\n50 0 obj\n<< /Length ${small.length} /Filter /FlateDecode >>\nstream\n`),
      small,
      Buffer.from('\nendstream\nendobj\n'),
    ])
    const result = await checkPdf(Buffer.concat([base, suffix]), 20)
    expect(result).toEqual({ ok: true, pageCount: 1 })
  }, 15_000)

  // --- bypass #1: indirect /Filter reference ---
  // Pre-scan: looks for literal "/FlateDecode" in the 512 bytes before "stream";
  //           "/Filter 9 0 R" does not contain that string → skipped.
  // Worker:   pdf-lib resolves "9 0 R" → /FlateDecode → FlateStream →
  //           ensureBuffer patch fires, OR pdf-lib rejects the unresolvable ref
  //           during XRef stream loading (parse_failed).  Either way: fail-closed.
  it('bypass #1: /Filter 9 0 R (indirect reference) is rejected', async () => {
    const bomb = zlib.deflateSync(Buffer.alloc(LIMIT + 1024))
    const pdf = buildXRefBombPdf('/Filter 9 0 R', bomb)
    const result = await checkPdf(pdf, 20)
    expect(result.ok).toBe(false)
  }, 15_000)

  // --- bypass #2: hex-escaped filter name /Fl#61teDecode ---
  // Pre-scan: does not resolve hex escapes; "/FlateDecode" literal not found → skipped.
  // Worker:   pdf-lib resolves /Fl#61teDecode → /FlateDecode → FlateStream → ensureBuffer.
  it('bypass #2: /Filter /Fl#61teDecode (hex-escaped name) is rejected', async () => {
    const bomb = zlib.deflateSync(Buffer.alloc(LIMIT + 1024))
    const pdf = buildXRefBombPdf('/Filter /Fl#61teDecode', bomb)
    const result = await checkPdf(pdf, 20)
    expect(result.ok).toBe(false)
  }, 15_000)

  // --- bypass #3: >512 bytes of padding between /FlateDecode and "stream" ---
  // Pre-scan: 512-byte look-back window does not reach "/FlateDecode" → skipped.
  // Worker:   pdf-lib sees normal /FlateDecode; FlateStream → ensureBuffer fires.
  it('bypass #3: /FlateDecode >512 bytes before stream keyword is rejected', async () => {
    const bomb = zlib.deflateSync(Buffer.alloc(LIMIT + 1024))
    // 100 dummy dict entries ≈ 600 bytes; pushes /FlateDecode out of the 512-byte window
    const dummyEntries = Array.from({ length: 100 }, (_, i) => `/K${i} ${i}`).join(' ')
    const pdf = buildXRefBombPdf(`/Filter /FlateDecode ${dummyEntries}`, bomb)
    const result = await checkPdf(pdf, 20)
    expect(result.ok).toBe(false)
  }, 15_000)

  // --- bypass #4: stored-block endstream trick ---
  // The compressed data opens with a zlib stored block (BFINAL=0) whose literal
  // content is the 9 bytes "endstream".  Pre-scan finds those bytes via indexOf and
  // truncates the stream data there; the truncated 7-byte prefix is not a complete
  // zlib stream, so inflate fails without consuming budget → pre-scan passes.
  // Worker: FlateStream reads the full /Length bytes; stored block outputs "endstream"
  //         (9 B), then the final deflate bomb block inflates → ensureBuffer fires.
  it('bypass #4: stored-block endstream prefix tricks indexOf; ensureBuffer catches bomb', async () => {
    const pdf = buildXRefBombPdf('/Filter /FlateDecode', makeStoredBlockBomb(LIMIT + 1024))
    const result = await checkPdf(pdf, 20)
    expect(result.ok).toBe(false)
  }, 15_000)

  // --- bypass #5: filter chain [/FlateDecode /FlateDecode] ---
  // Pre-scan: finds "/FlateDecode" in the array and inflates one layer → inner compressed
  //           (~1 KB) is well under LIMIT → passes.
  // Worker:   pdf-lib applies both layers; ensureBuffer cumulative total exceeds LIMIT
  //           on the second inflation.
  it('bypass #5: [/FlateDecode /FlateDecode] double-layer bomb is rejected', async () => {
    const inner = zlib.deflateSync(Buffer.alloc(LIMIT + 1024))
    const outer = zlib.deflateSync(inner)
    const pdf = buildXRefBombPdf('/Filter [/FlateDecode /FlateDecode]', outer)
    const result = await checkPdf(pdf, 20)
    expect(result.ok).toBe(false)
  }, 15_000)

  // --- bypass #6: "stream" not followed by \n or \r\n ---
  // Pre-scan: requires \n or \r\n after "stream"; missing newline → loop continues
  //           without scanning this occurrence → skipped.
  // Worker:   pdf-lib may reject the malformed stream (parse_failed) or inflate it;
  //           both outcomes are fail-closed.
  it('bypass #6: stream keyword with no trailing newline is rejected', async () => {
    const bomb = zlib.deflateSync(Buffer.alloc(LIMIT + 1024))
    const pdf = buildXRefBombPdf('/Filter /FlateDecode', bomb, /* noNewlineAfterStream */ true)
    const result = await checkPdf(pdf, 20)
    expect(result.ok).toBe(false)
  }, 15_000)
})
