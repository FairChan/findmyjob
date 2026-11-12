import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderInvoicePdf } from '@/server/lib/invoice-pdf'

// Exercise the real renderer, font, worker and standard PDF text extractor.
// Requires the same dependency/font prerequisites as invoice-render-t05.test.ts.
function snapshot(newline: string): Parameters<typeof renderInvoicePdf>[0] {
  return {
    schemaVersion: 1, templateVersion: 'invoice-v1', fontAssetVersion: 'findmyjob-invoice-sc-2.004-static400-v1',
    invoiceNo: 'FMJ-INV-00000001', issuedAt: '2026-11-09T16:30:00.000Z',
    orderId: 'c' + '1'.repeat(24), orderNo: 'FMJ-SYNTHETIC-NEWLINES', paidAt: '2026-11-09T16:00:00.000Z',
    issuer: {
      legalName: '合成测试开票主体', address: '合成开票地址首行' + newline + '合成开票地址次行',
      registrationNo: null, configVersion: 'synthetic-newline-v1',
    },
    buyer: {
      legalName: '合成测试购买主体', ssmRegNo: null,
      address: '合成购买地址首行' + newline + '合成购买地址次行',
    },
    item: { planCode: 'TEST_ONLY', kind: 'PLAN', nameZh: '合成测试年度套餐', nameEn: 'Synthetic annual plan', quantity: 1 },
    money: { currency: 'MYR', listPriceSen: 299900, discountSen: 149950, payableSen: 149950 },
    tax: { status: 'NOT_CONFIGURED', registrationNo: null, rate: null, amountSen: null },
  }
}

async function textLines(bytes: Buffer) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
  try {
    const doc = await task.promise
    const lines: { page: number; y: number; text: string }[] = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const content = await (await doc.getPage(pageNumber)).getTextContent()
      const byBaseline = new Map<number, string>()
      for (const item of content.items) {
        if (!('str' in item)) continue
        const baseline = Math.round(item.transform[5] * 1000) / 1000
        byBaseline.set(baseline, (byBaseline.get(baseline) ?? '') + item.str)
      }
      for (const [y, text] of byBaseline) lines.push({ page: pageNumber, y, text })
    }
    return lines
  } finally {
    await task.destroy()
  }
}

const visible = (text: string) => text.replace(/\s+/g, '')

describe('T05 real Chinese address newline preservation', () => {
  it.each([['CRLF', '\r\n'], ['CR', '\r']] as const)('renders %s as line boundaries without mutating the snapshot', async (_label, newline) => {
    const input = snapshot(newline)
    const before = structuredClone(input)
    const lines = await textLines(await renderInvoicePdf(input))
    const text = visible(lines.map(line => line.text).join(''))
    for (const expected of [
      input.invoiceNo, input.orderNo, input.issuer.legalName, input.buyer.legalName,
      input.item.nameZh, input.item.nameEn,
      ...input.issuer.address.split(newline), ...input.buyer.address!.split(newline),
    ]) expect(text).toContain(visible(expected))
    expect(text).not.toContain('\uFFFD')

    for (const address of [input.issuer.address, input.buyer.address!]) {
      const [firstText, secondText] = address.split(newline)
      const first = lines.find(line => visible(line.text).includes(firstText))
      const second = lines.find(line => visible(line.text).includes(secondText))
      expect(first).toBeDefined()
      expect(second).toBeDefined()
      expect(second!.page).toBe(first!.page)
      expect(second!.y).toBeLessThan(first!.y)
    }
    expect(input).toEqual(before)
  })
})
