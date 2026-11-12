import 'server-only'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../errors'
import { invoiceSnapshotSchema, type InvoiceSnapshot } from './invoice-snapshot'
import { INVOICE_FONT_SHA256 } from './invoice-font-manifest'
import { runCappedPdfWorker } from './pdf-worker'

const FONT_PATH = join(process.cwd(), 'assets/fonts/FindMYJobInvoiceSC-Regular.ttf')
const MAX_FONT_BYTES = 20 * 1024 * 1024
const MAX_PDF_BYTES = 8 * 1024 * 1024
let active = false

// Static source only. Neither a request nor invoice text can select executable code or modules.
const INVOICE_SCRIPT = `
const { PDFDocument, rgb } = pdfLib;
const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
// Runtime subsetting loses glyph outlines with the pinned fontkit version.
// Unencoded localized digits/ligatures lack a full-embedding ToUnicode mapping.
const font = await doc.embedFont(input, { subset: false, features: { locl: false, liga: false, clig: false } });
const supported = new Set(font.getCharacterSet());
const invoice = params.invoice;
const body = rgb(0.12, 0.16, 0.2);
const muted = rgb(0.28, 0.33, 0.38);
const accent = rgb(0.1, 0.27, 0.31);
const margin = 48;
const width = 595.28;
const height = 841.89;
let page;
let y;
function newPage() {
  if (doc.getPageCount() >= 4) throw new Error('PAGE_LIMIT');
  page = doc.addPage([width, height]);
  y = height - margin;
}
function ensureSpace(space) { if (y - space < margin + 24) newPage(); }
function write(text, size = 10, color = body, gap = 5) {
  const chars = Array.from(text.replace(/\\r\\n?/g, '\\n'));
  for (const char of chars) {
    if (char !== '\\n' && !supported.has(char.codePointAt(0))) throw new Error('UNSUPPORTED_GLYPH');
  }
  let line = '';
  const lines = [];
  for (const char of chars) {
    if (char === '\\n') { lines.push(line); line = ''; continue; }
    if (font.widthOfTextAtSize(line + char, size) > width - 2 * margin) {
      lines.push(line);
      line = char;
    } else line += char;
  }
  lines.push(line);
  for (const value of lines) {
    ensureSpace(size * 1.5);
    page.drawText(value, { x: margin, y: y - size, font, size, color });
    y -= size * 1.5;
  }
  y -= gap;
}
function section(label) { y -= 10; write(label, 12, accent, 7); }
function amount(sen) { return 'RM ' + (sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function date(value) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) + ' (Asia/Kuala_Lumpur)'; }
try {
  newPage();
  write('FindMYJob', 12, accent, 8);
  write('Invoice / 发票', 24, body, 12);
  write(invoice.invoiceNo, 12, body);
  write('Issue date / 开票日期: ' + date(invoice.issuedAt), 9, muted);
  write('Payment date / 付款日期: ' + date(invoice.paidAt), 9, muted);
  write('Order / 订单: ' + invoice.orderNo, 9, muted);
  section('Issued by / 开票方');
  write(invoice.issuer.legalName, 12);
  write(invoice.issuer.address);
  if (invoice.issuer.registrationNo !== null) write('Registration / 注册号: ' + invoice.issuer.registrationNo, 9, muted);
  section('Bill to / 购买方');
  write(invoice.buyer.legalName, 12);
  if (invoice.buyer.address !== null) write(invoice.buyer.address);
  if (invoice.buyer.ssmRegNo !== null) write('SSM / 注册号: ' + invoice.buyer.ssmRegNo, 9, muted);
  section('Description / 项目');
  write(invoice.item.nameZh, 12);
  write(invoice.item.nameEn);
  write('Quantity / 数量: 1', 9, muted);
  ensureSpace(120);
  section('Payment summary / 付款明细');
  write('List price / 原价: ' + amount(invoice.money.listPriceSen), 11);
  write('Discount / 优惠: ' + amount(invoice.money.discountSen), 11);
  write('Total paid / 已付总额: ' + amount(invoice.money.payableSen), 15, accent, 12);
  write('SST not separately itemised / SST 未单独列示', 9, muted);
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) pages[i].drawText((i + 1) + ' / ' + pages.length, { x: margin, y: 28, size: 8, font, color: muted });
  doc.setTitle('Invoice ' + invoice.invoiceNo);
  doc.setCreator('FindMYJob');
  doc.setProducer('FindMYJob');
  doc.setCreationDate(new Date(invoice.issuedAt));
  doc.setModificationDate(new Date(invoice.issuedAt));
  const bytes = await doc.save();
  if (bytes.length > 8 * 1024 * 1024) return { error: 'PDF_TOO_LARGE' };
  return { bytes };
} catch (error) {
  return { error: error instanceof Error && error.message === 'UNSUPPORTED_GLYPH' ? 'UNSUPPORTED_GLYPH' : error instanceof Error && error.message === 'PAGE_LIMIT' ? 'PDF_LAYOUT_EXCEEDED' : 'PDF_RENDER_FAILED' };
}
`

export async function renderInvoicePdf(snapshot: InvoiceSnapshot, signal?: AbortSignal): Promise<Buffer> {
  const parsed = invoiceSnapshotSchema.safeParse(snapshot)
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > 32 * 1024) {
    throw new AppError('Invoice snapshot is invalid', 'INVALID_INVOICE_SNAPSHOT', 400)
  }
  if (active) throw new AppError('Invoice renderer is busy', 'PDF_RENDER_FAILED', 503)
  active = true
  try {
    if (signal?.aborted) throw new AppError('Invoice render cancelled', 'PDF_RENDER_FAILED', 503)
    let font: Buffer
    try {
      const info = await stat(FONT_PATH)
      if (!info.isFile() || info.size > MAX_FONT_BYTES) throw new Error('Font asset unavailable')
      font = await readFile(FONT_PATH, { signal })
      if (font.length > MAX_FONT_BYTES || createHash('sha256').update(font).digest('hex') !== INVOICE_FONT_SHA256) {
        throw new Error('Font asset unavailable')
      }
    } catch {
      if (signal?.aborted) throw new AppError('Invoice render cancelled', 'PDF_RENDER_FAILED', 503)
      throw new AppError('Invoice font is unavailable', 'PDF_FONT_UNAVAILABLE', 503)
    }
    const result = await runCappedPdfWorker<{ bytes?: Uint8Array; error?: string }>(
      INVOICE_SCRIPT, font, { invoice: parsed.data },
      { maxInflatedBytes: 50 * 1024 * 1024, timeoutMs: 15_000, signal, includeFontkit: true },
    )
    if (result.ok && ['UNSUPPORTED_GLYPH', 'PDF_LAYOUT_EXCEEDED', 'PDF_TOO_LARGE'].includes(result.result.error ?? '')) {
      throw new AppError('Invoice cannot be rendered within document limits', result.result.error!, 400)
    }
    if (!result.ok || !(result.result.bytes instanceof Uint8Array) || result.result.bytes.length > MAX_PDF_BYTES) {
      throw new AppError('Invoice render failed', 'PDF_RENDER_FAILED', 503)
    }
    return Buffer.from(result.result.bytes)
  } catch (error) {
    if (error instanceof AppError && ['UNSUPPORTED_GLYPH', 'PDF_LAYOUT_EXCEEDED', 'PDF_TOO_LARGE', 'PDF_FONT_UNAVAILABLE'].includes(error.code)) throw error
    throw new AppError('Invoice render failed', 'PDF_RENDER_FAILED', 503)
  } finally {
    active = false
  }
}
