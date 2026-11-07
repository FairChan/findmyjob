/**
 * Unit tests for sanitizePdf.
 * Each test generates a minimal sample containing exactly one dangerous element,
 * then asserts it is absent from the sanitized output.
 * Per M4-T19/M4-T23: "把净化里对应的那一步删掉时，对应的那条测试要失败."
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { PDFDocument, PDFName, PDFHexString, PDFArray, PDFDict, PDFRef, PDFNumber, PDFNull, PDFRawStream, decodePDFRawStream } from 'pdf-lib'

const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

import { sanitizePdf } from '@/server/lib/pdf-sanitize'

beforeEach(() => {
  mockGetSetting.mockResolvedValue(50 * 1024 * 1024)
})

async function makeMinimalPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  return Buffer.from(await doc.save())
}

/** Add a /AA entry to the first page of an existing PDF bytes and return new bytes. */
async function addPageAA(pdfBuf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuf)
  const page = doc.getPage(0)
  page.node.set(PDFName.of('AA'), doc.context.obj({
    O: doc.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText('alert(1)') }),
  }))
  return Buffer.from(await doc.save())
}

/** Add a /AA entry to the catalog. */
async function addCatalogAA(pdfBuf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuf)
  doc.catalog.set(PDFName.of('AA'), doc.context.obj({
    WC: doc.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText('app.alert(1)') }),
  }))
  return Buffer.from(await doc.save())
}

/** Add a /OpenAction with JavaScript to the catalog. */
async function addOpenActionJS(pdfBuf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuf)
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({
    S: 'JavaScript',
    JS: PDFHexString.fromText('app.alert("open")'),
  }))
  return Buffer.from(await doc.save())
}

/** Add /Names /JavaScript entry to the catalog. */
async function addNamesJavaScript(pdfBuf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuf)
  const names = doc.context.obj({
    JavaScript: doc.context.obj({
      Names: doc.context.obj([
        PDFHexString.fromText('script1'),
        doc.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText('alert(2)') }),
      ]),
    }),
  })
  doc.catalog.set(PDFName.of('Names'), names)
  return Buffer.from(await doc.save())
}

/** Add /Names /EmbeddedFiles to catalog. */
async function addNamesEmbeddedFiles(pdfBuf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuf)
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({
    EmbeddedFiles: doc.context.obj({ Names: [] }),
  }))
  return Buffer.from(await doc.save())
}

/** Add a Link annotation with /Launch action to the first page. */
async function addLaunchAnnotation(pdfBuf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuf)
  const page = doc.getPage(0)
  const annotRef = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [10, 10, 100, 30],
    A: { S: 'Launch', F: PDFHexString.fromText('/bin/sh') },
  }))
  const existing = page.node.get(PDFName.of('Annots'))
  const arr = existing ? doc.context.obj([existing, annotRef]) : doc.context.obj([annotRef])
  page.node.set(PDFName.of('Annots'), arr)
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

/** Add a FileAttachment annotation to the first page. */
async function addFileAttachmentAnnotation(pdfBuf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuf)
  const page = doc.getPage(0)
  const annotRef = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'FileAttachment',
    Rect: [10, 50, 100, 70],
    FS: { Type: 'Filespec', F: PDFHexString.fromText('malware.exe') },
  }))
  page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

/** Add an AcroForm to the catalog. */
async function addAcroForm(pdfBuf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuf)
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({
    Fields: [],
    XFA: PDFHexString.fromText('<xfa:data xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"/>'),
  }))
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

/** Check that a named catalog key is absent in the given PDF bytes. */
async function catalogHasKey(pdfBuf: Buffer, key: string): Promise<boolean> {
  const doc = await PDFDocument.load(pdfBuf)
  return doc.catalog.has(PDFName.of(key))
}

/** Check that any page has /AA. */
async function anyPageHasAA(pdfBuf: Buffer): Promise<boolean> {
  const doc = await PDFDocument.load(pdfBuf)
  for (let i = 0; i < doc.getPageCount(); i++) {
    if (doc.getPage(i).node.has(PDFName.of('AA'))) return true
  }
  return false
}

// Structural helpers: use pdf-lib's object model to inspect annotations.

/** Collect /Subtype values from all annotations across all pages. */
async function getAnnotSubtypes(pdfBuf: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(pdfBuf)
  const subtypes: string[] = []
  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const ar = page.node.get(PDFName.of('Annots'))
    if (!ar) continue
    let annotsArr: PDFArray | undefined = undefined
    if (ar instanceof PDFArray) annotsArr = ar
    else if (ar instanceof PDFRef) { try { annotsArr = doc.context.lookup(ar, PDFArray) } catch {} }
    if (!annotsArr) continue
    for (let j = 0; j < annotsArr.size(); j++) {
      const item = annotsArr.get(j)
      let annotDict: PDFDict | undefined = undefined
      if (item instanceof PDFDict) annotDict = item
      else if (item instanceof PDFRef) { try { annotDict = doc.context.lookup(item, PDFDict) } catch {} }
      if (!annotDict) continue
      const st = annotDict.get(PDFName.of('Subtype'))
      if (st instanceof PDFName) subtypes.push(st.asString().replace(/^\//, ''))
    }
  }
  return subtypes
}

/** Collect /A/S action type strings from all annotations across all pages. */
async function getAnnotActionTypes(pdfBuf: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(pdfBuf)
  const types: string[] = []
  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const ar = page.node.get(PDFName.of('Annots'))
    if (!ar) continue
    let annotsArr: PDFArray | undefined = undefined
    if (ar instanceof PDFArray) annotsArr = ar
    else if (ar instanceof PDFRef) { try { annotsArr = doc.context.lookup(ar, PDFArray) } catch {} }
    if (!annotsArr) continue
    for (let j = 0; j < annotsArr.size(); j++) {
      const item = annotsArr.get(j)
      let annotDict: PDFDict | undefined = undefined
      if (item instanceof PDFDict) annotDict = item
      else if (item instanceof PDFRef) { try { annotDict = doc.context.lookup(item, PDFDict) } catch {} }
      if (!annotDict) continue
      const aRaw = annotDict.get(PDFName.of('A'))
      if (!aRaw) continue
      let aDict: PDFDict | undefined = undefined
      if (aRaw instanceof PDFDict) aDict = aRaw
      else if (aRaw instanceof PDFRef) { try { aDict = doc.context.lookup(aRaw, PDFDict) } catch {} }
      if (!aDict) continue
      const sRaw = aDict.get(PDFName.of('S'))
      if (sRaw instanceof PDFName) types.push(sRaw.asString().replace(/^\//, ''))
    }
  }
  return types
}

/** Return the key names of the first annotation on page 0, or [] if none. */
async function getFirstAnnotKeys(pdfBuf: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(pdfBuf)
  const page = doc.getPage(0)
  const ar = page.node.get(PDFName.of('Annots'))
  if (!ar) return []
  let annotsArr: PDFArray | undefined
  if (ar instanceof PDFArray) annotsArr = ar
  else if (ar instanceof PDFRef) { try { annotsArr = doc.context.lookup(ar, PDFArray) } catch {} }
  if (!annotsArr || annotsArr.size() === 0) return []
  const item = annotsArr.get(0)
  let annotDict: PDFDict | undefined
  if (item instanceof PDFDict) annotDict = item
  else if (item instanceof PDFRef) { try { annotDict = doc.context.lookup(item, PDFDict) } catch {} }
  if (!annotDict) return []
  return annotDict.keys().map((k) => k.asString().replace(/^\//, ''))
}

/** Return true if any page has the given key. */
async function anyPageHasKey(pdfBuf: Buffer, key: string): Promise<boolean> {
  const doc = await PDFDocument.load(pdfBuf)
  for (let i = 0; i < doc.getPageCount(); i++) {
    if (doc.getPage(i).node.has(PDFName.of(key))) return true
  }
  return false
}

describe('sanitizePdf', () => {
  it('removes page /AA', async () => {
    const base = await addPageAA(await makeMinimalPdf())
    expect(await anyPageHasAA(base)).toBe(true) // confirm sample has /AA

    const result = await sanitizePdf(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await anyPageHasAA(result.pdf)).toBe(false)
  }, 30_000)

  it('removes catalog /AA', async () => {
    const base = await addCatalogAA(await makeMinimalPdf())
    expect(await catalogHasKey(base, 'AA')).toBe(true)

    const result = await sanitizePdf(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await catalogHasKey(result.pdf, 'AA')).toBe(false)
  }, 30_000)

  it('removes catalog /OpenAction', async () => {
    const base = await addOpenActionJS(await makeMinimalPdf())
    expect(await catalogHasKey(base, 'OpenAction')).toBe(true)

    const result = await sanitizePdf(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await catalogHasKey(result.pdf, 'OpenAction')).toBe(false)
  }, 30_000)

  it('removes catalog /Names (JavaScript)', async () => {
    const base = await addNamesJavaScript(await makeMinimalPdf())
    expect(await catalogHasKey(base, 'Names')).toBe(true)

    const result = await sanitizePdf(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await catalogHasKey(result.pdf, 'Names')).toBe(false)
  }, 30_000)

  it('removes catalog /Names (EmbeddedFiles)', async () => {
    const base = await addNamesEmbeddedFiles(await makeMinimalPdf())
    expect(await catalogHasKey(base, 'Names')).toBe(true)

    const result = await sanitizePdf(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await catalogHasKey(result.pdf, 'Names')).toBe(false)
  }, 30_000)

  it('removes Launch action annotation', async () => {
    const base = await addLaunchAnnotation(await makeMinimalPdf())
    expect((await getAnnotActionTypes(base)).includes('Launch')).toBe(true)

    const result = await sanitizePdf(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotActionTypes(result.pdf)).includes('Launch')).toBe(false)
  }, 30_000)

  it('removes FileAttachment annotation', async () => {
    const base = await addFileAttachmentAnnotation(await makeMinimalPdf())
    expect((await getAnnotSubtypes(base)).includes('FileAttachment')).toBe(true)

    const result = await sanitizePdf(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotSubtypes(result.pdf)).includes('FileAttachment')).toBe(false)
  }, 30_000)

  it('removes AcroForm', async () => {
    const base = await addAcroForm(await makeMinimalPdf())
    expect(await catalogHasKey(base, 'AcroForm')).toBe(true)

    const result = await sanitizePdf(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await catalogHasKey(result.pdf, 'AcroForm')).toBe(false)
  }, 30_000)

  it('preserves /GoTo Link annotation and page count — rebuilt as minimal /Dest dict', async () => {
    // Create a 2-page PDF with a GoTo link on page 0 pointing to page 1.
    // D[0] must be a PDFRef of a page in this document — use getPage(1).ref.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    const page1 = doc.getPage(1)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [10, 700, 200, 720],
      A: { S: 'GoTo', D: doc.context.obj([page1.ref, PDFName.of('XYZ'), null, null, null]) },
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect((await PDFDocument.load(result.pdf)).getPageCount()).toBe(2)
    // GoTo link preserved — rebuilt as /Dest link (no /A key in rebuilt dict)
    const subtypes = await getAnnotSubtypes(result.pdf)
    expect(subtypes).toContain('Link')
    // Minimal dict: only Type, Subtype, Rect, Border, Dest
    const annotKeys = await getFirstAnnotKeys(result.pdf)
    expect(new Set(annotKeys)).toEqual(new Set(['Type', 'Subtype', 'Rect', 'Border', 'Dest']))
  }, 30_000)

  it('removes /Next-chained JavaScript on a Link annotation — GoTo link itself preserved', async () => {
    // A GoTo Link with a /Next JavaScript action — the Next chain must be blocked.
    // After sanitization, the link is rebuilt as a minimal /Dest dict (no /A, no /Next).
    // D[0] must be a page PDFRef so only the /Next removal step is tested here.
    // Red-run: skip annotation rebuild → no /Annots after copy → expect(ar).not.toBeUndefined() fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    const page1 = doc.getPage(1)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: {
        S: 'GoTo',
        D: [page1.ref, PDFName.of('XYZ'), null, null, null],
        Next: { S: 'JavaScript', JS: PDFHexString.fromText('app.alert(1)') },
      },
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The GoTo link must be preserved (stripped of /Next), rebuilt as /Dest
    const afterDoc = await PDFDocument.load(result.pdf)
    const ar = afterDoc.getPage(0).node.get(PDFName.of('Annots'))
    expect(ar).not.toBeUndefined()

    // Rebuilt annotation must NOT have /A (no action, no /Next possible)
    const annotKeys = await getFirstAnnotKeys(result.pdf)
    expect(annotKeys).not.toContain('A')
    expect(annotKeys).not.toContain('Next')
    expect(annotKeys).toContain('Dest')
  }, 30_000)

  it('removes annotation-level /AA — GoTo link itself preserved', async () => {
    // A GoTo Link annotation that also has its own /AA.
    // After sanitization, the link is rebuilt as a minimal /Dest dict (no /AA).
    // D[0] must be a page PDFRef so only the /AA removal step is tested here.
    // Red-run: skip annotation rebuild → no /Annots after copy → expect(ar).not.toBeUndefined() fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    const page1 = doc.getPage(1)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: { S: 'GoTo', D: [page1.ref, PDFName.of('XYZ'), null, null, null] },
      AA: { E: { S: 'JavaScript', JS: PDFHexString.fromText('app.alert(1)') } },
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The GoTo link must still be present
    const afterDoc = await PDFDocument.load(result.pdf)
    const afterPage = afterDoc.getPage(0)
    const ar = afterPage.node.get(PDFName.of('Annots'))
    expect(ar).not.toBeUndefined() // link preserved

    let annotsArr: PDFArray | undefined
    if (ar instanceof PDFArray) annotsArr = ar
    else if (ar instanceof PDFRef) { try { annotsArr = afterDoc.context.lookup(ar, PDFArray) } catch {} }
    const aaFlags: boolean[] = []
    for (let j = 0; j < (annotsArr?.size() ?? 0); j++) {
      const item = annotsArr!.get(j)
      let annotDict: PDFDict | undefined
      if (item instanceof PDFDict) annotDict = item
      else if (item instanceof PDFRef) { try { annotDict = afterDoc.context.lookup(item, PDFDict) } catch {} }
      aaFlags.push(annotDict?.has(PDFName.of('AA')) ?? false)
    }
    expect(aaFlags.every(f => f === false)).toBe(true)
  }, 30_000)

  it('returns { ok: false, reason: "encrypted" } for PDF with /Encrypt in trailer', async () => {
    // Add a /Encrypt dict to the trailer — pdf-lib detects isEncrypted from its presence.
    // The worker loads with ignoreEncryption:true and returns { kind:'encrypted' }.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const encryptRef = doc.context.register(doc.context.obj({
      Filter: 'Standard',
      V: 1,
      R: 2,
      O: PDFHexString.fromText('\x00'.repeat(32)),
      U: PDFHexString.fromText('\x00'.repeat(32)),
      P: -4,
    }))
    doc.context.trailerInfo.Encrypt = encryptRef
    const encPdf = Buffer.from(await doc.save())

    const result = await sanitizePdf(encPdf)
    expect(result.ok).toBe(false)
    expect((result as { ok: false; reason: string }).reason).toBe('encrypted')
  }, 30_000)

  // -------------------------------------------------------------------------
  // M4-T23 new tests: strict whitelist
  // -------------------------------------------------------------------------

  it('removes URI action Link annotation', async () => {
    // URI links are rejected — not a GoTo with explicit dest array.
    // Red-run: change acceptance check to also allow 'URI' actions →
    //   getAnnotActionTypes returns ['URI'] → expect(...).not.toContain('URI') fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: { S: 'URI', URI: PDFHexString.fromText('https://evil.example/') },
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    expect((await getAnnotActionTypes(pdfBuf)).includes('URI')).toBe(true)

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotActionTypes(result.pdf)).includes('URI')).toBe(false)
    // No Link annotations at all (URI is the only annotation)
    const subtypes = await getAnnotSubtypes(result.pdf)
    expect(subtypes).not.toContain('Link')
  }, 30_000)

  it('removes /PA from Link annotation — GoTo link itself preserved', async () => {
    // /PA (print action) must not appear in the rebuilt annotation.
    // D[0] must be a page PDFRef so only the /PA removal step is tested here.
    // Red-run: skip annotation rebuild (keep original dict) → /PA remains in output → test fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    const page1 = doc.getPage(1)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: { S: 'GoTo', D: [page1.ref, PDFName.of('XYZ'), null, null, null] },
      PA: { S: 'URI', URI: PDFHexString.fromText('https://print.evil.example/') },
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Link preserved (GoTo with explicit /D is accepted)
    expect((await getAnnotSubtypes(result.pdf)).includes('Link')).toBe(true)
    // /PA must be gone — minimal rebuild excludes it
    const annotKeys = await getFirstAnnotKeys(result.pdf)
    expect(annotKeys).not.toContain('PA')
    expect(annotKeys).toContain('Dest')
  }, 30_000)

  it('removes named-destination GoTo Link annotation', async () => {
    // /A /S /GoTo /D /DestName — named destination: D is a PDFName, not an array → rejected.
    // Red-run: remove the resolveArray check (accept any /D value) →
    //   named dest link is kept → getAnnotSubtypes contains 'Link' → expect().not.toContain fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    // /D is a PDFName (named destination), not an explicit array
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: { S: 'GoTo', D: PDFName.of('DestName') },
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Named-dest GoTo has no explicit array /D → not accepted → annotation removed
    const subtypes = await getAnnotSubtypes(result.pdf)
    expect(subtypes).not.toContain('Link')
  }, 30_000)

  it('removes GoTo3D Link annotation', async () => {
    // GoTo3D is not GoTo → rejected.
    // D has a valid page ref so only "must be GoTo" can reject it.
    // Red-run: change acceptance to allow any action type (remove s === 'GoTo' check) →
    //   GoTo3D link is kept → getAnnotActionTypes contains 'GoTo3D' → expect fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: doc.context.obj({ S: PDFName.of('GoTo3D'), D: doc.context.obj([doc.getPage(0).ref, PDFName.of('Fit')]) }),
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotActionTypes(result.pdf)).includes('GoTo3D')).toBe(false)
    expect((await getAnnotSubtypes(result.pdf)).includes('Link')).toBe(false)
  }, 30_000)

  it('removes Thread Link annotation', async () => {
    // Thread action is not GoTo → rejected.
    // D has a valid page ref so only "must be GoTo" can reject it.
    // Red-run: change acceptance to allow any action type →
    //   Thread link kept → getAnnotActionTypes contains 'Thread' → expect fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: doc.context.obj({ S: PDFName.of('Thread'), D: doc.context.obj([doc.getPage(0).ref, PDFName.of('Fit')]) }),
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotActionTypes(result.pdf)).includes('Thread')).toBe(false)
    expect((await getAnnotSubtypes(result.pdf)).includes('Link')).toBe(false)
  }, 30_000)

  it('removes GoToR Link annotation', async () => {
    // GoToR (remote GoTo) is not GoTo → rejected.
    // D has a valid page ref so only "must be GoTo" can reject it.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: doc.context.obj({ S: PDFName.of('GoToR'), D: doc.context.obj([doc.getPage(0).ref, PDFName.of('Fit')]) }),
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotActionTypes(result.pdf)).includes('GoToR')).toBe(false)
    expect((await getAnnotSubtypes(result.pdf)).includes('Link')).toBe(false)
  }, 30_000)

  it('removes GoToE Link annotation', async () => {
    // GoToE (embedded GoTo) is not GoTo → rejected.
    // D has a valid page ref so only "must be GoTo" can reject it.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: doc.context.obj({ S: PDFName.of('GoToE'), D: doc.context.obj([doc.getPage(0).ref, PDFName.of('Fit')]) }),
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotActionTypes(result.pdf)).includes('GoToE')).toBe(false)
    expect((await getAnnotSubtypes(result.pdf)).includes('Link')).toBe(false)
  }, 30_000)

  it('removes page /Thumb', async () => {
    // Page whitelist: /Thumb is not in PAGE_KEY_ALLOW → dropped.
    // Red-run: remove the page whitelist loop → /Thumb remains → anyPageHasKey returns true → fails.
    const doc = await PDFDocument.load(await makeMinimalPdf())
    const page = doc.getPage(0)
    // /Thumb is a stream object; use a placeholder dict as stand-in for the test
    page.node.set(PDFName.of('Thumb'), doc.context.obj({ Width: 10, Height: 10 }))
    const pdfBuf = Buffer.from(await doc.save())

    expect(await anyPageHasKey(pdfBuf, 'Thumb')).toBe(true)

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await anyPageHasKey(result.pdf, 'Thumb')).toBe(false)
  }, 30_000)

  it('removes page /PieceInfo', async () => {
    // Page whitelist: /PieceInfo is not in PAGE_KEY_ALLOW → dropped.
    // Red-run: remove the page whitelist loop → /PieceInfo remains → anyPageHasKey returns true → fails.
    const doc = await PDFDocument.load(await makeMinimalPdf())
    const page = doc.getPage(0)
    page.node.set(PDFName.of('PieceInfo'), doc.context.obj({
      AdobeIllustrator: doc.context.obj({ Private: PDFHexString.fromText('metadata') }),
    }))
    const pdfBuf = Buffer.from(await doc.save())

    expect(await anyPageHasKey(pdfBuf, 'PieceInfo')).toBe(true)

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await anyPageHasKey(result.pdf, 'PieceInfo')).toBe(false)
  }, 30_000)

  it('removes XFA from AcroForm', async () => {
    // AcroForm with /XFA is entirely removed (catalog strip removes /AcroForm).
    // Red-run: remove the outDoc.catalog.delete('AcroForm') step →
    //   AcroForm with XFA stays → catalogHasKey returns true → fails.
    const doc = await PDFDocument.load(await makeMinimalPdf())
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({
      Fields: [],
      XFA: PDFHexString.fromText('<xfa:data xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"/>'),
    }))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    expect(await catalogHasKey(pdfBuf, 'AcroForm')).toBe(true)

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // AcroForm entirely removed → XFA gone with it
    expect(await catalogHasKey(result.pdf, 'AcroForm')).toBe(false)
  }, 30_000)

  it('preserves page text content after sanitization', async () => {
    // Page content streams must survive; sanitization must not corrupt the page body.
    // Red-run: remove copyPages (do not transfer page content) →
    //   output is empty → PDF has 0 pages → pageCount check fails.
    // Red-run for hex assertion: remove the drawText call →
    //   decoded stream has no Tj → hex assertion fails.
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    page.drawText('Hello sanitize test', { x: 50, y: 700, size: 12 })
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const afterDoc = await PDFDocument.load(result.pdf)
    // Page count preserved
    expect(afterDoc.getPageCount()).toBe(1)
    // /Resources still present and has a Font entry with /BaseFont /Helvetica
    const resources = afterDoc.getPage(0).node.get(PDFName.of('Resources'))
    expect(resources).toBeDefined()
    const resourcesDict = resources instanceof PDFDict ? resources
      : afterDoc.context.lookup(resources as PDFRef, PDFDict)
    const fontDict = resourcesDict?.get(PDFName.of('Font'))
    const fontDictResolved: PDFDict | null = fontDict instanceof PDFDict ? fontDict
      : (fontDict instanceof PDFRef ? afterDoc.context.lookup(fontDict, PDFDict) : null)
    expect(fontDictResolved).not.toBeNull()
    const helveticaEntries = fontDictResolved!.keys().filter((k) => {
      const fontEntryVal = fontDictResolved!.get(k)
      const fontEntry: PDFDict | null = fontEntryVal instanceof PDFDict ? fontEntryVal
        : (fontEntryVal instanceof PDFRef ? (() => { try { return afterDoc.context.lookup(fontEntryVal as PDFRef, PDFDict) } catch { return null } })() : null)
      const baseFontVal = fontEntry?.get(PDFName.of('BaseFont'))
      return baseFontVal instanceof PDFName && baseFontVal.asString().includes('Helvetica')
    })
    expect(helveticaEntries.length).toBeGreaterThan(0)
    // Decoded content stream must contain the text as WinAnsi hex-encoded string with Tj operator.
    // pdf-lib may produce a single PDFRef or a PDFArray of refs depending on internal state.
    const contentsVal = afterDoc.getPage(0).node.get(PDFName.of('Contents'))
    expect(contentsVal).toBeDefined()
    const contentsRefs: PDFRef[] = []
    if (contentsVal instanceof PDFRef) {
      contentsRefs.push(contentsVal)
    } else if (contentsVal instanceof PDFArray) {
      for (let j = 0; j < contentsVal.size(); j++) {
        const el = contentsVal.get(j)
        if (el instanceof PDFRef) contentsRefs.push(el)
      }
    }
    expect(contentsRefs.length).toBeGreaterThan(0)
    const streamTexts = contentsRefs.map((ref) => {
      try {
        const obj = afterDoc.context.lookup(ref)
        if (!(obj instanceof PDFRawStream)) return ''
        return Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1')
      } catch { return '' }
    })
    const allStreams = streamTexts.join('\n')
    const textHex = Buffer.from('Hello sanitize test', 'latin1').toString('hex').toUpperCase()
    expect(allStreams).toContain(`<${textHex}>`)
    expect(allStreams).toContain('Tj')
  }, 30_000)

  it('preserves MediaBox and CropBox values after sanitization', async () => {
    // These are in PAGE_KEY_ALLOW → must survive with exact numeric values.
    // Red-run: remove PAGE_KEY_ALLOW (drop all page keys including MediaBox) →
    //   MediaBox gone → page renders with zero size → check below fails.
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842]) // A4
    page.setMediaBox(0, 0, 595, 842)
    page.setCropBox(10, 10, 575, 822)
    const pdfBuf = Buffer.from(await doc.save())

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const afterPage = (await PDFDocument.load(result.pdf)).getPage(0)
    const { width, height } = afterPage.getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)
    // CropBox must be preserved with its exact original values
    const cropBoxVal = afterPage.node.get(PDFName.of('CropBox'))
    expect(cropBoxVal).toBeDefined()
    // getCropBox() returns { x, y, width, height } where width/height are dimensions
    const cropBox = afterPage.getCropBox()
    expect(Math.round(cropBox.x)).toBe(10)
    expect(Math.round(cropBox.y)).toBe(10)
    // setCropBox(x, y, width, height) → width=575-10=565, height=822-10=812... actually
    // pdf-lib's setCropBox(x, y, width, height) where width and height are the actual
    // dimension values (not the upper-right corner). setCropBox(10, 10, 575, 822) sets
    // the box from (10,10) with width=575 and height=822.
    expect(Math.round(cropBox.width)).toBe(575)
    expect(Math.round(cropBox.height)).toBe(822)
  }, 30_000)

  it('preserves page /Rotate after sanitization', async () => {
    // /Rotate is in PAGE_KEY_ALLOW → must survive.
    // Red-run: remove PAGE_KEY_ALLOW (drop Rotate) → Rotate gone → afterPage.getRotation() returns 0 → fails.
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    page.setRotation({ type: 'degrees' as const, angle: 90 } as Parameters<typeof page.setRotation>[0])
    const pdfBuf = Buffer.from(await doc.save())

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const afterPage = (await PDFDocument.load(result.pdf)).getPage(0)
    expect(afterPage.node.has(PDFName.of('Rotate'))).toBe(true)
    expect(afterPage.getRotation().angle).toBe(90)
  }, 30_000)

  // -------------------------------------------------------------------------
  // M4-T25 new tests: target validation, /Dest Form 1, Rect validation, ref remapping
  // -------------------------------------------------------------------------

  it('preserves /Dest [pageRef /Fit] Form-1 link (direct /Dest array on annotation)', async () => {
    // Form 1: annotation has /Dest array directly (no /A dict).
    // D[0] is a PDFRef pointing to page 1 — must be preserved.
    // Red-run: remove srcRefToIdx.has check → named dests would also pass →
    //   but more directly: change validateDestArr to always return false →
    //   link is dropped → subtypes empty → expect(...).toContain('Link') fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    doc.addPage([612, 792])
    const page0 = doc.getPage(0)
    const page1 = doc.getPage(1)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      Dest: doc.context.obj([page1.ref, PDFName.of('Fit')]),
    }))
    page0.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotSubtypes(result.pdf)).includes('Link')).toBe(true)
    // Rebuilt as /Dest link (no /A key)
    const annotKeys = await getFirstAnnotKeys(result.pdf)
    expect(annotKeys).toContain('Dest')
    expect(annotKeys).not.toContain('A')
  }, 30_000)

  it('removes GoTo link when /D first element is a non-page object ref', async () => {
    // /A /S /GoTo /D where D[0] is a PDFRef to a Font dict (not a page) → rejected.
    // Red-run: remove srcRefToIdx check in validateDestArr → non-page refs accepted →
    //   link is kept → subtypes contains 'Link' → expect().not.toContain fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    // Register a non-page object (a plain dict)
    const nonPageRef = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }))
    const page = doc.getPage(0)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: doc.context.obj({ S: PDFName.of('GoTo'), D: doc.context.obj([nonPageRef, PDFName.of('Fit')]) }),
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotSubtypes(result.pdf)).includes('Link')).toBe(false)
  }, 30_000)

  it('removes GoTo link when /D first element is ref 9999 0 R (not in document)', async () => {
    // /A /S /GoTo /D where D[0] is a PDFRef with object number 9999 (not in this doc) → rejected.
    // Red-run: remove srcRefToIdx check → non-existent ref accepted →
    //   link kept → expect().not.toContain('Link') fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    // PDFRef.of(objectNumber, generationNumber)
    const ghostRef = PDFRef.of(9999, 0)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: doc.context.obj({ S: PDFName.of('GoTo'), D: doc.context.obj([ghostRef, PDFName.of('Fit')]) }),
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotSubtypes(result.pdf)).includes('Link')).toBe(false)
  }, 30_000)

  it('removes Link annotation when /Rect has only 3 numbers', async () => {
    // /Rect must be exactly 4 PDFNumber elements; a Rect with 3 elements is invalid → rejected.
    // Red-run: remove validateRectArr check → 3-element Rect passes →
    //   link kept → subtypes contains 'Link' → expect().not.toContain fails.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    doc.addPage([612, 792])
    const page = doc.getPage(0)
    const page1 = doc.getPage(1)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link',
      Rect: doc.context.obj([10, 10, 100]),  // only 3 numbers
      A: doc.context.obj({ S: PDFName.of('GoTo'), D: doc.context.obj([page1.ref, PDFName.of('Fit')]) }),
    }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((await getAnnotSubtypes(result.pdf)).includes('Link')).toBe(false)
  }, 30_000)

  it('remaps srcDoc page refs to outDoc page refs in rebuilt Dest[0] (object number shift)', async () => {
    // After sanitize, Dest[0] must point to outDoc's page 1, not srcDoc's page 1.
    // We add extra dummy objects in srcDoc before the pages so page refs have higher numbers.
    // In the fresh outDoc, objects are numbered from scratch — the page refs differ.
    // Red-run: remove ref remapping (push srcFirst instead of copiedPages[idx].ref) →
    //   Dest[0].toString() equals srcDoc page1 ref string → not.toBe check fails.
    const doc = await PDFDocument.create()
    // Extra objects to shift page ref numbers in srcDoc
    for (let i = 0; i < 5; i++) doc.context.register(doc.context.obj({ dummy: i }))
    doc.addPage([612, 792]) // page 0
    doc.addPage([612, 792]) // page 1
    const srcPage0 = doc.getPage(0)
    const srcPage1 = doc.getPage(1)
    const annotRef = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30],
      A: doc.context.obj({ S: PDFName.of('GoTo'), D: doc.context.obj([srcPage1.ref, PDFName.of('Fit')]) }),
    }))
    srcPage0.node.set(PDFName.of('Annots'), doc.context.obj([annotRef]))
    const pdfBuf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const result = await sanitizePdf(pdfBuf)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const outDoc = await PDFDocument.load(result.pdf)
    expect(outDoc.getPageCount()).toBe(2)

    const outPage0 = outDoc.getPage(0)
    const annotsVal = outPage0.node.get(PDFName.of('Annots'))
    expect(annotsVal).toBeDefined()
    let annotsArr: PDFArray | undefined
    if (annotsVal instanceof PDFArray) annotsArr = annotsVal
    else if (annotsVal instanceof PDFRef) { try { annotsArr = outDoc.context.lookup(annotsVal, PDFArray) } catch {} }
    expect(annotsArr).toBeDefined()
    expect(annotsArr!.size()).toBe(1)

    const item = annotsArr!.get(0)
    let annotDict: PDFDict | undefined
    if (item instanceof PDFDict) annotDict = item
    else if (item instanceof PDFRef) { try { annotDict = outDoc.context.lookup(item, PDFDict) } catch {} }
    expect(annotDict).toBeDefined()

    const destVal = annotDict!.get(PDFName.of('Dest'))
    let destArr: PDFArray | undefined
    if (destVal instanceof PDFArray) destArr = destVal
    else if (destVal instanceof PDFRef) { try { destArr = outDoc.context.lookup(destVal, PDFArray) } catch {} }
    expect(destArr).toBeDefined()

    const destFirst = destArr!.get(0)
    expect(destFirst).toBeInstanceOf(PDFRef)
    // Dest[0] must equal outDoc's page 1 ref
    expect((destFirst as PDFRef).toString()).toBe(outDoc.getPage(1).ref.toString())
    // And must NOT equal srcDoc's page 1 ref (they were renumbered)
    expect((destFirst as PDFRef).toString()).not.toBe(srcPage1.ref.toString())
  }, 30_000)
})
