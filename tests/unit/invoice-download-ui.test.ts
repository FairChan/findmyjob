// @vitest-environment jsdom
// Real panel/React/next-intl. Only browser transport/download APIs are isolated.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { Blob as NodeBlob } from 'node:buffer'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { OrderInvoicePanel } from '@/app/[locale]/e/billing/[orderId]/order-invoice-panel'
import { click, downloadButton, invoice, messages, mount, orderId, pdf, privateText, response, setupUi, unmount } from '../helpers/invoice-ui-t05'

setupUi()
const fetchMock = vi.fn()
const createUrl = vi.fn<(value: Blob | MediaSource) => string>(() => 'blob:http://localhost/synthetic-invoice')
const revokeUrl = vi.fn()
const downloads: { href: string; filename: string }[] = []
beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset().mockResolvedValue(response())
  createUrl.mockClear(); revokeUrl.mockClear(); downloads.length = 0
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('URL', class extends URL { static createObjectURL(value: Blob | MediaSource) { return createUrl(value) }; static revokeObjectURL(value: string) { revokeUrl(value) } })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ href: this.href, filename: this.download }) })
})
afterEach(async () => { await unmount(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

for (const locale of ['zh', 'en'] as const) {
  describe(locale + ' paid invoice presentation and download', () => {
    it('shows safe invoice metadata and a local refresh link without requesting a PDF on render', async () => {
      await mount(locale, createElement(OrderInvoicePanel, { orderId, invoice }))
      expect(document.querySelector('[data-testid="order-invoice"]')?.textContent).toContain(invoice.invoiceNo)
      expect(document.querySelector('time')?.getAttribute('datetime')).toBe(invoice.issuedAt)
      expect(document.querySelector('a')?.getAttribute('href')).toBe('/' + locale + '/e/billing/' + orderId)
      expect(downloadButton(locale).disabled).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })
    it.each([null, 'QUEUED', 'PROCESSING', 'FAILED'] as const)('never downloads or offers a task retry for %s', async (status) => {
      await mount(locale, createElement(OrderInvoicePanel, { orderId, invoice: status ? { ...invoice, pdfStatus: status } : null }))
      const copy = messages(locale).billingInvoice
      expect(document.body.textContent).toContain(status === null ? copy.notIssued : status === 'FAILED' ? copy.unavailable : copy.processing)
      expect(document.querySelector('button,form')).toBeNull()
      expect(document.querySelector('a')?.getAttribute('href')).toBe('/' + locale + '/e/billing/' + orderId)
      expect(fetchMock).not.toHaveBeenCalled()
    })
    it('downloads only on click with bounded PDF bytes and revokes its Blob URL', async () => {
      fetchMock.mockResolvedValue(response({ chunks: [pdf.slice(0, 3), pdf.slice(3)] }))
      await mount(locale, createElement(OrderInvoicePanel, { orderId, invoice }))
      await click(downloadButton(locale))
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/invoices/' + invoice.id + '/download', expect.objectContaining({
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/pdf' }, signal: expect.any(AbortSignal),
      }))
      const blob = createUrl.mock.calls[0]?.[0] as unknown as Blob
      expect(blob.type).toBe('application/pdf'); expect(blob.size).toBe(pdf.byteLength)
      expect(downloads).toEqual([{ href: 'blob:http://localhost/synthetic-invoice', filename: invoice.invoiceNo + '.pdf' }])
      expect(document.querySelector('a[download]')).toBeNull()
      expect(document.querySelector('[role="status"]')?.textContent).toBe(messages(locale).billingInvoice.downloadStarted)
      await act(async () => vi.advanceTimersByTimeAsync(1000))
      expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/synthetic-invoice')
    })
    it.each([[409, 'pending'], [503, 'unavailable'], [403, 'forbidden'], [404, 'notFound'], [500, 'generic']] as const)('keeps the page and uses safe wording for HTTP %s', async (status, key) => {
      fetchMock.mockResolvedValue(new Response(privateText, { status, headers: { 'content-type': 'application/json' } }))
      await mount(locale, createElement(OrderInvoicePanel, { orderId, invoice }))
      await click(downloadButton(locale))
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(messages(locale).billingInvoice.error[key])
      expect(document.body.innerHTML).not.toContain(privateText)
      expect(downloadButton(locale).disabled).toBe(false)
      expect(document.querySelector('a')?.getAttribute('href')).toBe('/' + locale + '/e/billing/' + orderId)
      expect(createUrl).not.toHaveBeenCalled(); expect(downloads).toHaveLength(0)
      expect(fetchMock).toHaveBeenCalledOnce()
    })
    it('keeps explicit download retry after a network failure without exposing exceptions', async () => {
      fetchMock.mockRejectedValueOnce(new Error(privateText))
      await mount(locale, createElement(OrderInvoicePanel, { orderId, invoice }))
      await click(downloadButton(locale))
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(messages(locale).billingInvoice.error.generic)
      expect(document.body.innerHTML).not.toContain(privateText)
      expect(fetchMock).toHaveBeenCalledOnce()
      await click(downloadButton(locale))
      expect(fetchMock).toHaveBeenCalledTimes(2); expect(downloads).toHaveLength(1)
    })
  })
}

describe('download protocol and lifecycle boundaries', () => {
  it('keeps the server-rendered download control disabled until client hydration', () => {
    const props = {
      locale: 'en', messages: messages('en'), timeZone: 'Asia/Kuala_Lumpur',
      children: createElement(OrderInvoicePanel, { orderId, invoice }),
    }
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, props))
    const container = document.createElement('div')
    container.innerHTML = html
    expect(container.querySelector('button')?.disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  async function reject(value: Response) {
    fetchMock.mockResolvedValue(value)
    await mount('en', createElement(OrderInvoicePanel, { orderId, invoice }))
    await click(downloadButton('en'))
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    expect(createUrl).not.toHaveBeenCalled(); expect(downloads).toHaveLength(0)
    expect(document.body.innerHTML).not.toContain(privateText)
  }
  const unsafeHeaders: Record<string, string>[] = [
    { 'content-type': 'text/html' },
    { 'content-disposition': 'inline; filename="invoice.pdf"' },
    { 'content-disposition': 'attachment; filename="../../' + privateText + '.pdf"' },
    { 'x-content-type-options': 'unsafe' },
  ]
  it.each(unsafeHeaders)('rejects unsafe response headers: %j', async (headers) => { expect.assertions(4); await reject(response({ headers })) })
  it('rejects an oversized advertised file before consuming it', async () => {
    const cancel = vi.fn()
    await reject(response({ headers: { 'content-length': String(8 * 1024 * 1024 + 1) }, cancel }))
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('cancels an actually oversized stream without trusting a missing length', async () => {
    const cancel = vi.fn()
    await reject(response({ chunks: [new Uint8Array(8 * 1024 * 1024), new Uint8Array(1), pdf], omitLength: true, cancel }))
    expect(cancel).toHaveBeenCalledOnce()
  })
  it.each([new Uint8Array(), new TextEncoder().encode('<html>not a PDF</html>')])('rejects empty or non-PDF data', async (data) => { expect.assertions(4); await reject(response({ chunks: [data] })) })
  it('rejects inconsistent advertised and actual sizes', async () => { expect.assertions(4); await reject(response({ headers: { 'content-length': String(pdf.byteLength + 1) } })) })
  it('accepts a bounded PDF when content length is absent', async () => {
    fetchMock.mockResolvedValue(response({ omitLength: true }))
    await mount('en', createElement(OrderInvoicePanel, { orderId, invoice })); await click(downloadButton('en'))
    expect(downloads).toHaveLength(1)
  })
  it('preserves a safe historical invoice number outside the new numbering series', async () => {
    const historical = { ...invoice, invoiceNo: 'LEGACY-INV_' + '9'.repeat(89) }
    expect(historical.invoiceNo).toHaveLength(100)
    fetchMock.mockResolvedValue(response({ headers: { 'content-disposition': 'attachment; filename="' + historical.invoiceNo + '.pdf"' } }))
    await mount('en', createElement(OrderInvoicePanel, { orderId, invoice: historical })); await click(downloadButton('en'))
    expect(downloads).toEqual([{ href: 'blob:http://localhost/synthetic-invoice', filename: historical.invoiceNo + '.pdf' }])
  })
  it.each(['LEGACY.INV', 'A'.repeat(101)])('rejects invoice numbers outside the server ASCII contract: %s', async (invoiceNo) => {
    await mount('en', createElement(OrderInvoicePanel, { orderId, invoice: { ...invoice, invoiceNo } })); await click(downloadButton('en'))
    expect(fetchMock).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })
  it('does not request a caller-controlled path in place of an invoice ID', async () => {
    await mount('en', createElement(OrderInvoicePanel, { orderId, invoice: { ...invoice, id: '../' + privateText + '?redirect=https://attacker.invalid' } }))
    await click(downloadButton('en'))
    expect(fetchMock).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled()
    expect(document.body.innerHTML).not.toContain(privateText)
  })
  it('allows one in-flight request even when two clicks occur before the state commits', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>((done) => { resolve = done }))
    await mount('en', createElement(OrderInvoicePanel, { orderId, invoice }))
    const button = downloadButton('en')
    await act(async () => { button.click(); button.click() })
    expect(button.disabled).toBe(true); expect(fetchMock).toHaveBeenCalledOnce()
    await act(async () => resolve(response()))
    expect(button.disabled).toBe(false); expect(downloads).toHaveLength(1)
  })
  it('aborts on unmount and never downloads a late response', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>((done) => { resolve = done }))
    await mount('en', createElement(OrderInvoicePanel, { orderId, invoice })); await click(downloadButton('en'))
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    await unmount(); expect(signal.aborted).toBe(true)
    await act(async () => resolve(response()))
    expect(createUrl).not.toHaveBeenCalled(); expect(downloads).toHaveLength(0)
  })
  it('aborts a stalled download within the bounded request deadline', async () => {
    fetchMock.mockImplementation((_url, options: RequestInit) => new Promise((_resolve, rejectRequest) => {
      options.signal?.addEventListener('abort', () => rejectRequest(new Error(privateText)), { once: true })
    }))
    await mount('en', createElement(OrderInvoicePanel, { orderId, invoice })); await click(downloadButton('en'))
    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true)
    expect(downloadButton('en').disabled).toBe(false)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(messages('en').billingInvoice.error.generic)
    expect(createUrl).not.toHaveBeenCalled()
  })
  it('aborts a stalled response body after headers without creating a partial download', async () => {
    fetchMock.mockImplementation((_url, options: RequestInit) => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(pdf.slice(0, 5))
        options.signal?.addEventListener('abort', () => controller.error(new Error(privateText)), { once: true })
      },
    }), { headers: response().headers })))
    await mount('en', createElement(OrderInvoicePanel, { orderId, invoice }))
    await click(downloadButton('en'))
    expect(downloadButton('en').disabled).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true)
    expect(downloadButton('en').disabled).toBe(false)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(messages('en').billingInvoice.error.generic)
    expect(createUrl).not.toHaveBeenCalled()
    expect(downloads).toHaveLength(0)
  })
})
