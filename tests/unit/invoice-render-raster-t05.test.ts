import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderInvoicePdf } from '@/server/lib/invoice-pdf'
import { INVOICE_FONT_VERSION, INVOICE_TEMPLATE_VERSION } from '@/server/lib/invoice-snapshot'

// Resolve the existing PDF.js native dependency under pnpm; no direct package
// addition and no renderer/worker/font mock.
const localRequire = createRequire(import.meta.url)
const canvasRequire = createRequire(localRequire.resolve('pdfjs-dist/package.json'))
const { createCanvas } = canvasRequire('@napi-rs/canvas') as {
  createCanvas(width: number, height: number): {
    getContext(kind: '2d'): CanvasRenderingContext2D
  }
}
const markers = ['B', 'D', 'P', 'X', '合', '成', '测', '试'] as const
const compact = (value: string) => value.replace(/\s+/g, '')

function snapshot(): Parameters<typeof renderInvoicePdf>[0] {
  return {
    schemaVersion: 1, templateVersion: INVOICE_TEMPLATE_VERSION, fontAssetVersion: INVOICE_FONT_VERSION,
    invoiceNo: 'FMJ-INV-00000003', issuedAt: '2026-11-09T21:29:00.000Z',
    orderId: 'c111111111111111111111111', orderNo: 'FMJ-20261110-V3J8', paidAt: '2026-11-09T21:29:00.000Z',
    issuer: {
      legalName: 'SYNTHETIC 合成开票主体 M8 02_42_1759F',
      address: 'SYNTHETIC 合成开票地址一号\r\nSynthetic Suite 2',
      registrationNo: 'TEST-00804', configVersion: 'synthetic-font-investigation-v1',
    },
    buyer: { legalName: 'M8 02_42_1759F 合成测试企业', address: markers.join('\n'), ssmRegNo: 'TEST-00805' },
    item: { planCode: 'TEST_ONLY', kind: 'PLAN', nameZh: '合成测试年度招聘套餐方案', nameEn: 'Synthetic office affine Plan & Co.', quantity: 1 },
    money: { currency: 'MYR', listPriceSen: 299900, discountSen: 149950, payableSen: 149950 },
    tax: { status: 'NOT_CONFIGURED', registrationNo: null, rate: null, amountSen: null },
  }
}

describe('T05 real invoice glyph raster regression', () => {
  it('paints isolated Latin and Chinese glyphs and preserves numbers and words', async () => {
    const input = snapshot(), before = structuredClone(input)
    const bytes = await renderInvoicePdf(input)
    expect(bytes.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024)
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true })
    try {
      const pdf = await task.promise
      const texts: string[] = [], samples: { marker: string; ink: number }[] = []
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber), viewport = page.getViewport({ scale: 2 })
        const surface = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        const context = surface.getContext('2d')
        await page.render({ canvas: surface as unknown as HTMLCanvasElement, canvasContext: context, viewport }).promise
        const content = await page.getTextContent()
        const items = content.items.filter(item => 'str' in item)
        texts.push(items.map(item => item.str).join(''))
        for (const marker of markers) {
          for (const item of items.filter(item => item.str === marker)) {
            const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
            const size = Math.hypot(item.transform[2], item.transform[3])
            // ToUnicode is only the locator. One marker per line keeps crops
            // disjoint; adjacent text cannot satisfy the actual ink assertion.
            const pixels = context.getImageData(
              Math.floor(x - 2), Math.floor(y - size * 2.1),
              Math.ceil(Math.max(item.width, size) * 2 + 4), Math.ceil(size * 2.2),
            ).data
            let ink = 0
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] < 160 && pixels[i + 1] < 160 && pixels[i + 2] < 160) ink++
            }
            samples.push({ marker, ink })
          }
        }
      }
      const text = compact(texts.join('\n'))
      for (const expected of [
        input.invoiceNo, input.orderNo, input.issuer.legalName, input.issuer.address,
        input.buyer.legalName, input.buyer.address!, input.item.nameZh, input.item.nameEn,
        '10/11/2026, 05:29', 'RM 2,999.00', 'RM 1,499.50', 'Invoice / 发票',
        'Bill to / 购买方', 'Description / 项目', 'Payment summary / 付款明细',
      ]) expect(text).toContain(compact(expected))
      for (const marker of markers) {
        const matches = samples.filter(sample => sample.marker === marker)
        expect(matches, `one isolated marker ${marker}`).toHaveLength(1)
        expect(matches[0].ink, `visible ink for ${marker}`).toBeGreaterThanOrEqual(5)
      }
      expect(input).toEqual(before)
    } finally {
      await task.destroy()
    }
  })
})
