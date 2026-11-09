/** Three real invoice flows.
 * Requires exclusive local test DB + local storage + real Chinese PDF assets.
 * No direct PAID/READY writes, route mocks, signed URLs, or product test API. */
import { test, expect } from '@playwright/test'
import { e2eDb as db } from './helpers/db'
import { COPY, evidence, privatePayloadGuard } from './helpers/billing-t02-ui'
import { copy, downloadAndCheck, invoiceState, InvoiceUiFixture, runInvoiceChild } from './helpers/invoice-t05-ui'

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' })
test.describe('T05 real invoice issuance and download', () => {
  test.setTimeout(300_000)
  let fixture: InvoiceUiFixture
  test.beforeEach(async ({ page, browser, baseURL }) => {
    expect(test.info().config.workers, 'Use one worker and an exclusive local test database').toBe(1)
    fixture = new InvoiceUiFixture(page, browser, baseURL)
    await fixture.init()
  })
  test.afterEach(async () => { if (fixture) await fixture.cleanup() })

  for (const locale of ['zh', 'en'] as const) {
    test(locale + ': real bank payment queues one invoice and downloads the same PDF after sales close', async ({}, info) => {
      const { owner, order, plan, invoice, buyer } = await fixture.paidOrder(locale)
      const t = copy(locale).billingInvoice
      const orderPath = '/' + locale + '/e/billing/' + order.id
      const downloadPath = '/api/invoices/' + invoice.id + '/download'
      const requests: string[] = []
      owner.page.on('request', request => { if (new URL(request.url()).pathname === downloadPath) requests.push(request.method()) })
      const privacy = await privatePayloadGuard(owner.page)
      await owner.page.goto(orderPath)
      await expect(owner.page.getByTestId('order-status')).toHaveText(COPY[locale].paid)
      const panel = owner.page.getByTestId('order-invoice')
      await expect(panel).toContainText(t.processing)
      await expect(panel).toContainText(invoice.invoiceNo)
      await expect(panel.getByRole('button')).toHaveCount(0)
      expect(requests).toEqual([])
      const queued = await invoiceState(order.id)
      await panel.getByRole('link', { name: t.refresh, exact: true }).click()
      await expect(panel).toContainText(t.processing)
      expect(await invoiceState(order.id)).toEqual(queued)
      await evidence(owner.page, info, locale + '-invoice-queued', '[data-testid="order-invoice"]')

      await runInvoiceChild(fixture.marker, owner.actor.companyId, order.id, 'process')
      const ready = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
      expect(ready.pdfStatus).toBe('READY')
      expect(ready.invoiceNo).toBe(invoice.invoiceNo)
      expect(ready.invoiceSnapshot).toEqual(invoice.invoiceSnapshot)
      await panel.getByRole('link', { name: t.refresh, exact: true }).click()
      await expect(panel).toContainText(t.ready)
      expect(requests).toEqual([])
      const beforeDownload = await invoiceState(order.id)
      const first = await downloadAndCheck(owner.page, locale, invoice.id, invoice.invoiceNo, info, locale + '-invoice-original')
      expect(first.hash).toBe(ready.pdfSha256)
      expect(await invoiceState(order.id)).toEqual(beforeDownload)
      expect(requests).toEqual(['GET'])
      await expect(panel.getByRole('status')).toHaveText(t.downloadStarted)
      await evidence(owner.page, info, locale + '-invoice-ready', '[data-testid="order-invoice"]')
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const document = pdfjs.getDocument({ data: new Uint8Array(first.bytes), useSystemFonts: false })
      try {
        const pdf = await document.promise
        let text = ''
        for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
          const content = await (await pdf.getPage(pageNo)).getTextContent()
          text += content.items.map(item => 'str' in item ? item.str : '').join('')
        }
        const compact = text.replace(/\s+/g, '')
        expect(compact).toContain(buyer.replace(/\s+/g, ''))
        expect(compact).toContain(fixture.issuer.legalName.replace(/\s+/g, ''))
        expect(compact).toContain(invoice.invoiceNo)
        expect(compact).toContain('1,499.50')
        expect(compact).toContain('SSTnotseparatelyitemised')
        expect(compact).not.toMatch(/TaxInvoice|0%|免税|MyInvoisvalidated|LHDNverified|\uFFFD/i)
      } finally { await document.destroy() }

      const settled = await invoiceState(order.id)
      await fixture.billing(false)
      await db.plan.update({ where: { id: plan.id }, data: { isActive: false, isPublic: false, priceSen: 999900 } })
      await fixture.saveIssuer({ ...fixture.issuer, version: fixture.marker + '-CHANGED', legalName: fixture.issuer.legalName + ' 新配置' })
      await owner.page.reload()
      await expect(owner.page.getByTestId('order-status')).toHaveText(COPY[locale].paid)
      const historical = await downloadAndCheck(owner.page, locale, invoice.id, invoice.invoiceNo, info, locale + '-invoice-after-sales-close')
      expect(historical.hash).toBe(first.hash)
      expect(await invoiceState(order.id)).toEqual(settled)
      expect(requests).toEqual(['GET', 'GET'])
      await privacy([], [ready.pdfKey!, fixture.issuer.legalName, fixture.issuer.address])
    })
  }

  test('a demoted owner keeps the open page but cannot download the ready invoice', async ({}, info) => {
    const { owner, order, invoice } = await fixture.paidOrder('en')
    await runInvoiceChild(fixture.marker, owner.actor.companyId, order.id, 'process')
    const orderPath = '/en/e/billing/' + order.id
    const downloadPath = '/api/invoices/' + invoice.id + '/download'
    const t = copy('en').billingInvoice
    await owner.page.goto(orderPath)
    const panel = owner.page.getByTestId('order-invoice')
    await expect(panel.getByRole('button', { name: t.download, exact: true })).toBeVisible()
    const before = await invoiceState(order.id)
    const downloads: string[] = []
    owner.page.on('download', download => downloads.push(download.suggestedFilename()))
    // Owned synthetic membership mutation models revocation after the page was read.
    await db.companyMember.update({ where: { userId: owner.actor.userId }, data: { role: 'RECRUITER' } })
    const denied = owner.page.waitForResponse(result => new URL(result.url()).pathname === downloadPath)
    await panel.getByRole('button', { name: t.download, exact: true }).click()
    expect((await denied).status()).toBe(403)
    await expect(panel.getByRole('alert')).toHaveText(t.error.forbidden)
    await expect(owner.page).toHaveURL(orderPath)
    await expect(owner.page.getByTestId('order-status')).toHaveText(COPY.en.paid)
    expect(downloads).toEqual([])
    expect(await invoiceState(order.id)).toEqual(before)
    await evidence(owner.page, info, 'invoice-owner-demoted', '[data-testid="order-invoice"]')
    const other = await fixture.owner()
    const missing = await other.page.request.get(downloadPath)
    expect(missing.status()).toBe(404)
    expect(missing.headers()['cache-control']).toContain('no-store')
    expect((await missing.text()).includes('invoices/')).toBe(false)
    expect(downloads).toEqual([])
    expect(await invoiceState(order.id)).toEqual(before)
  })
})
