import 'server-only'
import { runCappedPdfWorker } from './pdf-worker'

export type SanitizeResult =
  | { ok: true; pdf: Buffer }
  | { ok: false; reason: 'too_large' | 'timeout' | 'malformed' | 'encrypted' }

// SECURITY: script must be a static string constant. Caller-supplied values must
// come through `params` only — never interpolated into the script string.
// Removes: /AA (page and catalog), /OpenAction, /Names, /AcroForm.
// Annotation filter: keeps only /Subtype /Link with /A /S /GoTo (in-doc navigation),
// /Dest in-doc links, or /A /S /URI (external hyperlinks). Strips JS, Launch,
// FileAttachment, Widget, and all other action types that enable code execution
// or file access.
const SANITIZE_PDF_SCRIPT = `
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef } = pdfLib;
const srcDoc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
if (srcDoc.isEncrypted) return { kind: 'encrypted' };
const outDoc = await PDFDocument.create();
const pageCount = srcDoc.getPageCount();

// pdf-lib 1.17.x context.lookup only resolves PDFRef, not inline objects.
// Use instanceof checks directly for inline PDFName / PDFDict / PDFArray values.
function resolveName(ctx, val) {
  if (val instanceof PDFName) return val.asString().replace(/^\\//, '');
  if (val instanceof PDFRef) { try { const r = ctx.lookup(val, PDFName); return r ? r.asString().replace(/^\\//, '') : null; } catch { return null; } }
  return null;
}
function resolveDict(ctx, val) {
  if (val instanceof PDFDict) return val;
  if (val instanceof PDFRef) { try { return ctx.lookup(val, PDFDict); } catch { return null; } }
  return null;
}
function resolveArray(ctx, val) {
  if (val instanceof PDFArray) return val;
  if (val instanceof PDFRef) { try { return ctx.lookup(val, PDFArray); } catch { return null; } }
  return null;
}

// Sanitize annotations on srcDoc pages first. srcDoc.context refs are properly interned
// for the loaded input, so lookup is reliable here. After sanitizing, copy cleaned pages
// to outDoc — only referenced objects are deep-copied, so orphaned annotation dicts
// (those we removed) are never carried into outDoc.
const allowedActions = new Set(['GoTo', 'URI']);
for (let p = 0; p < pageCount; p++) {
  const page = srcDoc.getPage(p);
  page.node.delete(PDFName.of('AA'));
  const annotsVal = page.node.get(PDFName.of('Annots'));
  if (!annotsVal) continue;
  const annotsArr = resolveArray(srcDoc.context, annotsVal);
  if (!annotsArr) { page.node.delete(PDFName.of('Annots')); continue; }
  const kept = [];
  for (let i = 0; i < annotsArr.size(); i++) {
    const item = annotsArr.get(i);
    const annotDict = resolveDict(srcDoc.context, item);
    if (!annotDict) continue;
    // Strip annotation-level /AA
    annotDict.delete(PDFName.of('AA'));
    const subtypeName = resolveName(srcDoc.context, annotDict.get(PDFName.of('Subtype')));
    if (subtypeName !== 'Link') continue;
    const aVal = annotDict.get(PDFName.of('A'));
    if (aVal) {
      const actionDict = resolveDict(srcDoc.context, aVal);
      if (!actionDict) continue;
      // Reject chained actions (/Next) — they could bypass the allowlist
      if (actionDict.has(PDFName.of('Next'))) continue;
      const sName = resolveName(srcDoc.context, actionDict.get(PDFName.of('S')));
      if (!sName || !allowedActions.has(sName)) continue;
    }
    kept.push(item);
  }
  if (kept.length === 0) page.node.delete(PDFName.of('Annots'));
  else page.node.set(PDFName.of('Annots'), srcDoc.context.obj(kept));
}

// Copy sanitized pages into the fresh outDoc.
const copiedPages = await outDoc.copyPages(srcDoc, Array.from({ length: pageCount }, (_, i) => i));
for (const page of copiedPages) {
  outDoc.addPage(page);
}

// Belt-and-suspenders: strip catalog-level dangerous entries from outDoc
// (outDoc is fresh from create(), so these are no-ops unless copyPages pulled them in).
outDoc.catalog.delete(PDFName.of('OpenAction'));
outDoc.catalog.delete(PDFName.of('AA'));
outDoc.catalog.delete(PDFName.of('Names'));
outDoc.catalog.delete(PDFName.of('AcroForm'));
const bytes = await outDoc.save({ useObjectStreams: false });
return { kind: 'ok', bytes };
`

type SanitizeScriptResult =
  | { kind: 'ok'; bytes: Uint8Array }
  | { kind: 'encrypted' }

export async function sanitizePdf(
  input: Buffer,
  opts?: { timeoutMs?: number },
): Promise<SanitizeResult> {
  const result = await runCappedPdfWorker<SanitizeScriptResult>(
    SANITIZE_PDF_SCRIPT,
    input,
    undefined,
    { timeoutMs: opts?.timeoutMs ?? 10_000 },
  )

  if (!result.ok) {
    if (result.reason === 'too_large') return { ok: false, reason: 'too_large' }
    if (result.reason === 'timeout') return { ok: false, reason: 'timeout' }
    return { ok: false, reason: 'malformed' }
  }

  const inner = result.result
  if (inner.kind === 'encrypted') return { ok: false, reason: 'encrypted' }

  return { ok: true, pdf: Buffer.from(inner.bytes) }
}
