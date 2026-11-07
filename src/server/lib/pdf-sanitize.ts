import 'server-only'
import { runCappedPdfWorker } from './pdf-worker'

export type SanitizeResult =
  | { ok: true; pdf: Buffer }
  | { ok: false; reason: 'too_large' | 'timeout' | 'malformed' | 'encrypted' }

// SECURITY: script must be a static string constant. Caller-supplied values must
// come through `params` only — never interpolated into the script string.
//
// Sanitization pipeline:
//   1. Catalog: removes /OpenAction, /AA, /Names, /AcroForm.
//   2. Page whitelist: only Type, Parent, Resources, Contents, MediaBox, CropBox,
//      BleedBox, TrimBox, ArtBox, Rotate, UserUnit, Group — all other page-level
//      keys (/AA, /Thumb, /PieceInfo, /Trans, /Metadata, /B, etc.) are dropped.
//   3. Annotation rebuild: only Link annotations with an in-document /Dest (explicit
//      array, first element is a page PDFRef) or /A /S /GoTo with explicit /D array
//      are preserved. All other subtypes and all other action types (URI, GoToR,
//      GoToE, GoTo3D, Thread, RichMediaExecute, Launch, …) are dropped.
//      Preserved annotations are rebuilt from scratch as minimal dicts containing
//      only /Type /Annot, /Subtype /Link, /Rect, /Border [0 0 0], and /Dest —
//      stripping /AA, /PA, /Next chains, and any other extra keys.
const SANITIZE_PDF_SCRIPT = `
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef } = pdfLib;
const srcDoc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
if (srcDoc.isEncrypted) return { kind: 'encrypted' };
const outDoc = await PDFDocument.create();
const pageCount = srcDoc.getPageCount();

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

// Build srcDoc page-ref → page-index map for /Dest validation and remap.
const srcRefToIdx = new Map();
for (let i = 0; i < pageCount; i++) {
  srcRefToIdx.set(srcDoc.getPage(i).ref.toString(), i);
}

// Pass 1: collect annotations to keep from each srcDoc page, then clear all
// srcDoc page annotations.  Clearing before copyPages ensures that no original
// annotation objects (URI, GoTo3D, /AA, /PA, /Next chains, etc.) are
// deep-copied into outDoc — only page content (fonts, images, streams) transfers.
const preservedPerPage = [];
for (let p = 0; p < pageCount; p++) {
  const page = srcDoc.getPage(p);
  const kept = [];

  const annotsVal = page.node.get(PDFName.of('Annots'));
  if (annotsVal) {
    const annotsArr = resolveArray(srcDoc.context, annotsVal);
    if (annotsArr) {
      for (let i = 0; i < annotsArr.size(); i++) {
        const item = annotsArr.get(i);
        const annotDict = resolveDict(srcDoc.context, item);
        if (!annotDict) continue;

        const subtype = resolveName(srcDoc.context, annotDict.get(PDFName.of('Subtype')));
        if (subtype !== 'Link') continue;

        const rectVal = annotDict.get(PDFName.of('Rect'));
        if (!rectVal) continue;
        const rectArr = resolveArray(srcDoc.context, rectVal);
        if (!rectArr) continue;

        let destArr = null;

        // Form 1: /Dest is an explicit array whose first element is a page PDFRef.
        // Named destinations (/Dest is a name or string) are rejected.
        const destDirect = annotDict.get(PDFName.of('Dest'));
        if (destDirect) {
          const dArr = resolveArray(srcDoc.context, destDirect);
          if (dArr && dArr.size() > 0) {
            const firstEl = dArr.get(0);
            if (firstEl instanceof PDFRef && srcRefToIdx.has(firstEl.toString())) {
              destArr = dArr;
            }
          }
        }

        // Form 2: /A /S /GoTo with explicit /D array.
        // URI, GoToR, GoToE, GoTo3D, Thread, RichMediaExecute and all other action
        // types are rejected.  /Next chains are stripped by the rebuild step below.
        if (!destArr) {
          const aVal = annotDict.get(PDFName.of('A'));
          if (aVal) {
            const actionDict = resolveDict(srcDoc.context, aVal);
            if (actionDict) {
              const s = resolveName(srcDoc.context, actionDict.get(PDFName.of('S')));
              if (s === 'GoTo') {
                const dVal = actionDict.get(PDFName.of('D'));
                const dArr = resolveArray(srcDoc.context, dVal);
                if (dArr) destArr = dArr;
              }
            }
          }
        }

        if (destArr) kept.push({ rectArr, destArr });
      }
    }
  }
  // Clear all annotations from srcDoc page — will be rebuilt from scratch in outDoc.
  page.node.delete(PDFName.of('Annots'));
  preservedPerPage.push(kept);
}

// Copy sanitized pages into the fresh outDoc (no annotation objects are carried over).
const copiedPages = await outDoc.copyPages(srcDoc, Array.from({ length: pageCount }, (_, i) => i));

// Page key whitelist — all other keys (/AA, /Thumb, /PieceInfo, /Trans, /Metadata, /B …) are dropped.
const PAGE_KEY_ALLOW = new Set([
  'Type', 'Parent', 'Resources', 'Contents', 'MediaBox', 'CropBox',
  'BleedBox', 'TrimBox', 'ArtBox', 'Rotate', 'UserUnit', 'Group'
]);

for (let p = 0; p < pageCount; p++) {
  const page = copiedPages[p];
  outDoc.addPage(page);

  const keysToDelete = page.node.keys().filter(k => !PAGE_KEY_ALLOW.has(k.asString().replace(/^\\//, '')));
  for (const k of keysToDelete) page.node.delete(k);

  // Rebuild kept annotations as minimal /Dest dicts.
  // This strips /AA, /PA, /Next chains, and all other extra keys by construction.
  const annotData = preservedPerPage[p];
  if (annotData.length > 0) {
    const newAnnotRefs = annotData.map(({ rectArr, destArr }) => {
      // Remap srcDoc page PDFRefs in the destination array to outDoc page PDFRefs.
      const newDest = [];
      for (let k = 0; k < destArr.size(); k++) {
        const el = destArr.get(k);
        if (el instanceof PDFRef) {
          const idx = srcRefToIdx.get(el.toString());
          newDest.push(idx !== undefined ? copiedPages[idx].ref : el);
        } else {
          newDest.push(el);
        }
      }
      const rectElems = [];
      for (let k = 0; k < rectArr.size(); k++) rectElems.push(rectArr.get(k));
      return outDoc.context.register(outDoc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: outDoc.context.obj(rectElems),
        Border: outDoc.context.obj([0, 0, 0]),
        Dest: outDoc.context.obj(newDest),
      }));
    });
    page.node.set(PDFName.of('Annots'), outDoc.context.obj(newAnnotRefs));
  }
}

// Belt-and-suspenders: strip catalog-level dangerous entries from outDoc.
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
