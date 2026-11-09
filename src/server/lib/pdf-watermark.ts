import 'server-only'
import { runCappedPdfWorker } from './pdf-worker'

export type WatermarkResult =
  | { ok: true; pdf: Buffer }
  | { ok: false; reason: 'too_large' | 'timeout' | 'malformed' | 'aborted' }

// SECURITY: script must be a static string constant. Watermark text and userId
// must be passed via params, never interpolated.
// Embeds a diagonal watermark on every page. Text is ASCII-safe (Helvetica/WinAnsi).
// Layout uses the visible page coordinates, then compensates for PDF /Rotate.
const WATERMARK_PDF_SCRIPT = `
const { PDFDocument, StandardFonts, rgb, degrees } = pdfLib;
const { text } = params;
const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
const font = await doc.embedFont(StandardFonts.Helvetica);
const pageCount = doc.getPageCount();
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE_RATIO = 0.025;
function computeLayout(width, height, str) {
  let size = Math.max(MIN_FONT_SIZE, Math.min(width, height) * MAX_FONT_SIZE_RATIO);
  let tw = font.widthOfTextAtSize(str, size);
  const diagonal = Math.sqrt(width * width + height * height);
  if (tw > diagonal * 0.8) {
    size = Math.max(MIN_FONT_SIZE, (diagonal * 0.8 * size) / tw);
    tw = font.widthOfTextAtSize(str, size);
  }
  const angle = Math.PI / 4;
  const cx = width / 2;
  const cy = height / 2;
  const x = cx - (tw * Math.cos(angle)) / 2 + (size * Math.sin(angle)) / 2;
  const y = cy - (tw * Math.sin(angle)) / 2 - (size * Math.cos(angle)) / 2;
  return { x, y, size };
}
for (let i = 0; i < pageCount; i++) {
  const page = doc.getPage(i);
  const crop = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('Invalid page rotation');
  const swapsAxes = rotation === 90 || rotation === 270;
  const width = swapsAxes ? crop.height : crop.width;
  const height = swapsAxes ? crop.width : crop.height;
  const layout = computeLayout(width, height, text);
  // /Rotate rotates clockwise on display; map the visible origin back to user space.
  let x = layout.x;
  let y = layout.y;
  if (rotation === 90) { x = crop.width - layout.y; y = layout.x; }
  else if (rotation === 180) { x = crop.width - layout.x; y = crop.height - layout.y; }
  else if (rotation === 270) { x = layout.y; y = crop.height - layout.x; }
  page.drawText(text, {
    x: crop.x + x,
    y: crop.y + y,
    size: layout.size,
    font,
    color: rgb(0.5, 0.5, 0.5),
    opacity: 0.3,
    rotate: degrees(45 + rotation),
  });
}
return await doc.save({ useObjectStreams: false });
`

export async function watermarkPdf(
  input: Buffer,
  wm: { text: string },
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<WatermarkResult> {
  const result = await runCappedPdfWorker<Uint8Array>(
    WATERMARK_PDF_SCRIPT,
    input,
    { text: wm.text },
    { timeoutMs: opts?.timeoutMs ?? 10_000, signal: opts?.signal },
  )

  if (!result.ok) {
    if (result.reason === 'too_large') return { ok: false, reason: 'too_large' }
    if (result.reason === 'timeout') return { ok: false, reason: 'timeout' }
    if (result.reason === 'aborted') return { ok: false, reason: 'aborted' }
    return { ok: false, reason: 'malformed' }
  }

  const bytes = result.result
  return { ok: true, pdf: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
}
