import 'server-only'
import zlib from 'node:zlib'
import { Worker } from 'worker_threads'
import { getSetting } from '../services/settings'
// Static import so Next.js standalone file-tracing follows the pnpm symlink and
// creates the correct symlink structure (with tslib/pako as siblings) in standalone.
// Runtime usage is inside the eval worker string below; nft cannot see eval strings.
import 'pdf-lib'

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

// pdf-lib runs inside a Worker so decompression bombs cannot exhaust server heap.
// CJS require() is used because pdf-lib ships as CJS and eval workers default to CJS mode.
const PDF_WORKER_CODE = `
const { parentPort } = require('worker_threads');
const { PDFDocument } = require('pdf-lib');
parentPort.once('message', async (buf) => {
  try {
    const doc = await PDFDocument.load(Buffer.from(buf), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    if (doc.isEncrypted) {
      parentPort.postMessage({ ok: false, reason: 'encrypted' });
      return;
    }
    let pageCount;
    try { pageCount = doc.getPageCount(); } catch {
      parentPort.postMessage({ ok: false, reason: 'parse_failed' });
      return;
    }
    parentPort.postMessage({ ok: true, pageCount });
  } catch {
    parentPort.postMessage({ ok: false, reason: 'parse_failed' });
  }
});
`

/**
 * Scan raw bytes for encryption markers that could survive a trailer-override attack.
 * Checks for /Encrypt or the /Filter /Standard pattern together with /O and /U password
 * hashes. Returns true if the file looks encrypted regardless of what pdf-lib reports.
 */
export function hasRawEncryptionMarkers(buf: Buffer): boolean {
  const str = buf.toString('latin1')
  const hasEncryptRef = /\/Encrypt\b/.test(str)
  const hasStandardFilter = /\/Filter\s*\/Standard\b/.test(str)
  if (!hasEncryptRef && !hasStandardFilter) return false
  // /O and /U are the owner/user password hash fields in the encryption dictionary
  return /\/O\s*[(<]/.test(str) && /\/U\s*[(<]/.test(str)
}

function isBombError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return (e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
}

/**
 * Scan raw bytes for FlateDecode streams and try to inflate each one, tracking
 * the total decompressed size against a budget.
 * Returns true if a decompression bomb is detected (caller should reject).
 * Inflate errors that are NOT budget overflows are silently ignored — pdf-lib
 * will re-validate the stream and report parse errors on its own.
 */
export function checkInflateBomb(buf: Buffer, maxBytes: number): boolean {
  const STREAM_KW = Buffer.from('stream')
  const ENDSTREAM_KW = Buffer.from('endstream')
  let budget = maxBytes
  let pos = 0

  while (pos < buf.length) {
    const kw = buf.indexOf(STREAM_KW, pos)
    if (kw === -1) break

    // Skip 'endstream' (stream keyword preceded by 'end')
    if (
      kw >= 3 &&
      buf[kw - 1] === 0x64 && // 'd'
      buf[kw - 2] === 0x6e && // 'n'
      buf[kw - 3] === 0x65    // 'e'
    ) {
      pos = kw + 6
      continue
    }

    // 'stream' keyword must be followed by \n or \r\n (PDF spec)
    const after = kw + 6
    let dataStart: number
    if (after < buf.length && buf[after] === 0x0a) {
      dataStart = after + 1
    } else if (after + 1 < buf.length && buf[after] === 0x0d && buf[after + 1] === 0x0a) {
      dataStart = after + 2
    } else {
      pos = kw + 1
      continue
    }

    // Check if the preceding stream dictionary mentions /FlateDecode
    const lookBack = Math.max(0, kw - 512)
    const dictStr = buf.subarray(lookBack, kw).toString('latin1')
    if (!dictStr.includes('/FlateDecode')) {
      const endKw = buf.indexOf(ENDSTREAM_KW, dataStart)
      pos = endKw === -1 ? buf.length : endKw + 9
      continue
    }

    const endKw = buf.indexOf(ENDSTREAM_KW, dataStart)
    if (endKw === -1) {
      pos = kw + 1
      continue
    }

    const streamData = buf.subarray(dataStart, endKw)

    // Try zlib inflate (PDF FlateDecode uses zlib format; some use raw deflate)
    let inflated: Buffer | null = null
    try {
      inflated = zlib.inflateSync(streamData, { maxOutputLength: budget })
    } catch (e: unknown) {
      if (isBombError(e)) return true
      try {
        inflated = zlib.inflateRawSync(streamData, { maxOutputLength: budget })
      } catch (e2: unknown) {
        if (isBombError(e2)) return true
        // Corrupt or non-deflate data — let pdf-lib handle it
      }
    }

    if (inflated !== null) {
      budget -= inflated.length
      if (budget <= 0) return true
    }

    pos = endKw + 9
  }

  return false
}

/**
 * Parse the PDF via an isolated Worker with memory limits, then check page count.
 * Fail closed: timeout (10 s), OOM (resourceLimits), or any parse error → 'parse_failed'.
 * Also rejects 0-page PDFs (invalid document) and pages exceeding maxPages.
 */
export async function checkPdf(buf: Buffer, maxPages: number): Promise<PdfCheckResult> {
  // Raw-bytes encryption check supplements pdf-lib's parser; defends against trailer overrides
  if (hasRawEncryptionMarkers(buf)) {
    return { ok: false, reason: 'encrypted' }
  }

  // FlateDecode bomb check: pdf-lib inflates all streams without an upper bound;
  // a 5–10 MB compressed file can expand to gigabytes via Uint8Array (off-heap).
  // The Worker's resourceLimits.maxOldGenerationSizeMb only covers the JS heap,
  // so off-heap allocations can still exhaust the whole process. We scan first.
  const maxInflatedBytes = await getSetting('upload.pdfMaxInflatedBytes', 50 * 1024 * 1024)
  if (checkInflateBomb(buf, maxInflatedBytes)) {
    return { ok: false, reason: 'parse_failed' }
  }

  const result = await new Promise<{ ok: boolean; pageCount?: number; reason?: string }>(
    (resolve) => {
      const worker = new Worker(PDF_WORKER_CODE, {
        eval: true,
        resourceLimits: {
          // 256 MB heap cap prevents a 5–10 MB compressed PDF from expanding to gigabytes
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 64,
        },
      })

      const timer = setTimeout(() => {
        worker.terminate()
        resolve({ ok: false, reason: 'parse_failed' })
      }, 10_000)

      worker.once('message', (msg: { ok: boolean; pageCount?: number; reason?: string }) => {
        clearTimeout(timer)
        worker.terminate()
        resolve(msg)
      })

      worker.on('error', () => {
        clearTimeout(timer)
        resolve({ ok: false, reason: 'parse_failed' })
      })

      // Non-zero exit means OOM or uncaught exception inside worker
      worker.on('exit', (code) => {
        clearTimeout(timer)
        if (code !== 0) resolve({ ok: false, reason: 'parse_failed' })
      })

      worker.postMessage(buf)
    },
  )

  if (!result.ok) {
    const knownReasons = ['parse_failed', 'encrypted', 'too_many_pages'] as const
    type FailReason = (typeof knownReasons)[number]
    const rawReason = result.reason ?? 'parse_failed'
    const reason: FailReason = knownReasons.includes(rawReason as FailReason)
      ? (rawReason as FailReason)
      : 'parse_failed'
    return { ok: false, reason }
  }

  const pageCount = result.pageCount ?? 0

  if (pageCount < 1) {
    return { ok: false, reason: 'parse_failed' }
  }

  if (pageCount > maxPages) {
    return { ok: false, reason: 'too_many_pages' }
  }

  return { ok: true, pageCount }
}
