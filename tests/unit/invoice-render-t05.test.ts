import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderInvoicePdf } from '@/server/lib/invoice-pdf'
import { INVOICE_FONT_VERSION } from '@/server/lib/invoice-snapshot'

// Real renderer + fixed licensed local font + independent text extractor.
// No pdf-lib/fontkit/worker/font mocks; dependency and asset prerequisites are explicit.
function snapshot(): Parameters<typeof renderInvoicePdf>[0] {
  return {
    schemaVersion: 1, templateVersion: 'invoice-v1', fontAssetVersion: INVOICE_FONT_VERSION,
    invoiceNo: 'FMJ-INV-00000001', issuedAt: '2026-11-09T16:30:00.000Z',
    orderId: 'c' + '1'.repeat(24), orderNo: 'FMJ-SYNTHETIC-0001', paidAt: '2026-11-09T16:00:00.000Z',
    issuer: {
      legalName: '合成测试开票主体', address: '合成测试地址一号',
      registrationNo: null, configVersion: 'synthetic-v1',
    },
    buyer: { legalName: '合成测试华夏科技有限公司', ssmRegNo: null, address: '合成测试吉隆坡创业大道十八号' },
    item: { planCode: 'TEST_ONLY', kind: 'PLAN', nameZh: '合成测试年度招聘套餐', nameEn: 'Synthetic annual plan', quantity: 1 },
    money: { currency: 'MYR', listPriceSen: 299900, discountSen: 149950, payableSen: 149950 },
    tax: { status: 'NOT_CONFIGURED', registrationNo: null, rate: null, amountSen: null },
  }
}

async function extractText(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
  try {
    const doc = await task.promise
    const pages = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(''))
    }
    return pages.join('\n').replace(/\s+/g, '')
  } finally {
    await task.destroy()
  }
}

async function embeddedFontCount(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  let count = 0
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue
    if (['FontFile', 'FontFile2', 'FontFile3'].some(key => object.has(PDFName.of(key)))) count++
  }
  return count
}

describe('T05 real Chinese invoice rendering', () => {
  it.each(['noto-sans-cjk-sc-2.004', 'unknown-font'])('rejects unsupported font version %s without rewriting the snapshot', async version => {
    const input = { ...snapshot(), fontAssetVersion: version } as Parameters<typeof renderInvoicePdf>[0]
    const before = structuredClone(input)
    await expect(renderInvoicePdf(input)).rejects.toMatchObject({ code: 'INVALID_INVOICE_SNAPSHOT' })
    expect(input).toEqual(before)
  })

  it('embeds a font and preserves complete Chinese legal headings and product text', async () => {
    const input = snapshot()
    const before = structuredClone(input)
    const bytes = await renderInvoicePdf(input)
    const text = await extractText(bytes)
    expect(text).toContain(input.issuer.legalName)
    expect(text).toContain(input.buyer.legalName)
    expect(text).toContain(input.buyer.address)
    expect(text).toContain(input.item.nameZh)
    expect(text).not.toContain('\uFFFD')
    expect(await embeddedFontCount(bytes)).toBeGreaterThan(0)
    expect(input).toEqual(before)
  })

  it('shows the original list, discount and net payable without inventing tax certification', async () => {
    const text = await extractText(await renderInvoicePdf(snapshot()))
    expect(text).toContain('2,999.00')
    expect(text.match(/1,499\.50/g)?.length).toBeGreaterThanOrEqual(2)
    expect(text).toContain('SSTnotseparatelyitemised')
    expect(text).not.toMatch(/TaxInvoice|免税|0%|MyInvoisvalidated|LHDNverified|电子发票验证通过/i)
  })

  it('wraps long Chinese names and addresses without dropping characters or exceeding the page budget', async () => {
    const input = snapshot()
    input.buyer.legalName = '合成测试马来西亚中华科技教育文化交流发展有限公司'
    input.buyer.address = '合成测试吉隆坡创业大道十八号第三层中华科技园东区研究开发中心办公楼'
    const bytes = await renderInvoicePdf(input)
    const doc = await PDFDocument.load(bytes)
    const text = await extractText(bytes)
    expect(text).toContain(input.buyer.legalName)
    expect(text).toContain(input.buyer.address)
    expect(text).toContain('1,499.50')
    expect(doc.getPageCount()).toBeGreaterThan(0)
    expect(doc.getPageCount()).toBeLessThanOrEqual(4)
    expect(bytes.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024)
  })

  it('fails explicitly for an unsupported legal-name code point', async () => {
    const input = snapshot()
    input.buyer.legalName += String.fromCodePoint(0x10ffff)
    await expect(renderInvoicePdf(input)).rejects.toMatchObject({ code: 'UNSUPPORTED_GLYPH' })
  })

  it('emits a fixed passive document without actions, attachments or form fields', async () => {
    const bytes = await renderInvoicePdf(snapshot())
    const doc = await PDFDocument.load(bytes)
    for (const key of ['OpenAction', 'AA', 'AcroForm', 'Collection']) expect(doc.catalog.has(PDFName.of(key))).toBe(false)
    const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
    expect(names?.has(PDFName.of('JavaScript')) ?? false).toBe(false)
    expect(names?.has(PDFName.of('EmbeddedFiles')) ?? false).toBe(false)
    for (const page of doc.getPages()) {
      expect(page.node.has(PDFName.of('AA'))).toBe(false)
      const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
      expect(annotations?.size() ?? 0).toBe(0)
    }
  })
})
