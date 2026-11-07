import { vi, describe, it, expect, beforeEach } from 'vitest'
import zlib from 'node:zlib'
import { PDFDocument } from 'pdf-lib'

// Must be hoisted so the mock is in place before pdf-worker.ts is imported
const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

import { runCappedPdfWorker } from '@/server/lib/pdf-worker'

// Use a 1 MB budget so bombs stay small and tests run fast
const LIMIT = 1 * 1024 * 1024

beforeEach(() => {
  mockGetSetting.mockResolvedValue(LIMIT)
})

// ---------------------------------------------------------------------------
// Helpers shared with pdf-check bypass tests
// ---------------------------------------------------------------------------

async function makeValidPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) doc.addPage([612, 792])
  return Buffer.from(await doc.save())
}

/**
 * Build a minimal PDF-1.5 with an XRef stream.
 * pdf-lib MUST decompress the XRef stream, so the ensureBuffer patch fires.
 */
function buildXRefBombPdf(dictExtra: string, streamData: Buffer): Buffer {
  const header = Buffer.from('%PDF-1.5\n')
  const obj9 = Buffer.from('9 0 obj\n/FlateDecode\nendobj\n')
  const xrefHdr = Buffer.from(
    `99 0 obj\n<< /Type /XRef /Size 100 /W [1 2 1] /Length ${streamData.length} ${dictExtra} >>\nstream\n`,
  )
  const xrefFtr = Buffer.from('\nendstream\nendobj\n')
  const xrefOffset = header.length + obj9.length
  const trailerBuf = Buffer.from(`startxref\n${xrefOffset}\n%%EOF\n`)
  return Buffer.concat([header, obj9, xrefHdr, streamData, xrefFtr, trailerBuf])
}

// ---------------------------------------------------------------------------
describe('runCappedPdfWorker', () => {
  it('runs a script that loads a PDF and returns page count', async () => {
    const buf = await makeValidPdf(2)
    const result = await runCappedPdfWorker<{ pageCount: number }>(
      `
        const { PDFDocument } = pdfLib;
        const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
        return { pageCount: doc.getPageCount() };
      `,
      buf,
      undefined,
      { maxInflatedBytes: LIMIT },
    )
    expect(result).toEqual({ ok: true, result: { pageCount: 2 } })
  }, 15_000)

  it('runs a script that modifies a page and returns a saved Uint8Array', async () => {
    const buf = await makeValidPdf(1)
    const result = await runCappedPdfWorker<Uint8Array>(
      `
        const { PDFDocument, rgb } = pdfLib;
        const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
        const page = doc.getPage(0);
        page.drawText('WATERMARK', { x: 50, y: 400, size: 24, color: rgb(0.5, 0.5, 0.5) });
        return doc.save();
      `,
      buf,
      undefined,
      { maxInflatedBytes: LIMIT },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The result must be a valid PDF (re-loadable)
    const bytes = result.result
    expect(bytes).toBeInstanceOf(Uint8Array)
    const reloaded = await PDFDocument.load(bytes)
    expect(reloaded.getPageCount()).toBe(1)
  }, 15_000)

  it('routes [pdf-inflate-bomb] errors to too_large', async () => {
    // Verifies the error-routing in the worker harness.
    // The actual ensureBuffer patch is exercised by checkPdf bypass tests in pdf-check.test.ts.
    const buf = await makeValidPdf(1)
    const result = await runCappedPdfWorker<never>(
      `throw new Error('[pdf-inflate-bomb] cumulative budget exceeded')`,
      buf,
      undefined,
      { maxInflatedBytes: LIMIT },
    )
    expect(result).toEqual({ ok: false, reason: 'too_large' })
  }, 15_000)

  it('rejects a double-FlateDecode XRef bomb via load/page-count check', async () => {
    // PDF loads but yields 0 pages (XRef decompresses to zeros — not valid page entries).
    // The script mirrors CHECK_PDF_SCRIPT so the full pipeline rejects it.
    const inner = zlib.deflateSync(Buffer.alloc(LIMIT + 1024))
    const outer = zlib.deflateSync(inner)
    const pdf = buildXRefBombPdf('/Filter [/FlateDecode /FlateDecode]', outer)
    const result = await runCappedPdfWorker<{ kind: string; pageCount?: number }>(
      `
        const { PDFDocument } = pdfLib;
        const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
        if (doc.isEncrypted) return { kind: 'encrypted' };
        let pageCount;
        try { pageCount = doc.getPageCount(); } catch { return { kind: 'failed' }; }
        return { kind: 'ok', pageCount };
      `,
      pdf,
      undefined,
      { maxInflatedBytes: LIMIT },
    )
    // Either too_large (ensureBuffer fires) or ok with pageCount=0 (parse succeeds but empty doc)
    // or failed (pdf-lib rejects the malformed XRef) — all are valid fail-closed outcomes.
    const isEmptyDoc = result.ok && (result.result.pageCount ?? 0) === 0
    const isBombRejected = !result.ok && ['too_large', 'failed'].includes(result.reason)
    expect(isEmptyDoc || isBombRejected).toBe(true)
  }, 15_000)

  it('returns timeout when script contains an infinite loop', async () => {
    const buf = await makeValidPdf(1)
    const result = await runCappedPdfWorker<never>(
      `while (true) {}`,
      buf,
      undefined,
      { maxInflatedBytes: LIMIT, timeoutMs: 500 },
    )
    expect(result).toEqual({ ok: false, reason: 'timeout' })
  }, 5_000)

  it('returns failed when script throws an unexpected error', async () => {
    const buf = await makeValidPdf(1)
    const result = await runCappedPdfWorker<never>(
      `throw new Error('unexpected')`,
      buf,
      undefined,
      { maxInflatedBytes: LIMIT },
    )
    expect(result).toEqual({ ok: false, reason: 'failed' })
  }, 15_000)

  it('passes params to the script', async () => {
    const buf = await makeValidPdf(1)
    const result = await runCappedPdfWorker<{ echo: string }>(
      `return { echo: params.message }`,
      buf,
      { message: 'hello' },
      { maxInflatedBytes: LIMIT },
    )
    expect(result).toEqual({ ok: true, result: { echo: 'hello' } })
  }, 15_000)
})
