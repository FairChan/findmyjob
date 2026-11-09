'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { OrderDetail } from '@/server/services/billing'
import { Button } from '@/components/ui/button'
import { formatKLDateTime } from '@/lib/format-date'

interface Props { orderId: string; invoice: OrderDetail['invoice'] }
type Failure = 'pending' | 'unavailable' | 'forbidden' | 'notFound' | 'generic'
const failureKey = { pending: 'error.pending', unavailable: 'error.unavailable', forbidden: 'error.forbidden', notFound: 'error.notFound', generic: 'error.generic' } as const
const MAX_PDF_BYTES = 8 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 15_000
const validId = (value: string) => /^c[a-z0-9]{24}$/.test(value)
const validNumber = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)
const subscribeHydration = () => () => undefined
const clientReady = () => true
const serverReady = () => false

async function readPdf(response: Response, invoiceNo: string): Promise<ArrayBuffer> {
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  const disposition = response.headers.get('content-disposition')
  const filename = invoiceNo + '.pdf'
  if (response.status !== 200 || response.redirected || contentType !== 'application/pdf'
    || response.headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff'
    || (disposition !== 'attachment; filename="' + filename + '"' && disposition !== 'attachment; filename=' + filename)) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('PDF response rejected')
  }
  const headerLength = response.headers.get('content-length')
  const expected = headerLength === null ? null : /^[1-9][0-9]*$/.test(headerLength) ? Number(headerLength) : NaN
  if (expected !== null && (!Number.isSafeInteger(expected) || expected > MAX_PDF_BYTES)) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('PDF size rejected')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('PDF body unavailable')
  const data = new Uint8Array(MAX_PDF_BYTES)
  let length = 0
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      if (length + item.value.byteLength > MAX_PDF_BYTES) throw new Error('PDF size rejected')
      data.set(item.value, length)
      length += item.value.byteLength
    }
    if (length < 5 || (expected !== null && expected !== length)) throw new Error('PDF size rejected')
    if (String.fromCharCode(...data.subarray(0, 5)) !== '%PDF-') throw new Error('PDF body rejected')
    return data.buffer.slice(0, length)
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
}

export function OrderInvoicePanel({ orderId, invoice }: Props) {
  const t = useTranslations('billingInvoice')
  const locale = useLocale() === 'zh' ? 'zh' : 'en'
  const hydrated = useSyncExternalStore(subscribeHydration, clientReady, serverReady)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [started, setStarted] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(false)
  const request = useRef<AbortController | null>(null)
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    mounted.current = true
    const activeUrls = urls.current
    return () => {
      mounted.current = false
      request.current?.abort()
      for (const [url, timer] of activeUrls) { clearTimeout(timer); URL.revokeObjectURL(url) }
      activeUrls.clear()
    }
  }, [])

  async function download() {
    if (inFlight.current || invoice?.pdfStatus !== 'READY') return
    if (!validId(invoice.id) || !validNumber(invoice.invoiceNo)) { setFailure('unavailable'); return }
    inFlight.current = true
    setPending(true)
    setFailure(null)
    setStarted(false)
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
    try {
      const response = await fetch('/api/invoices/' + encodeURIComponent(invoice.id) + '/download', {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/pdf' }, signal: controller.signal,
      })
      if (!mounted.current || controller.signal.aborted) { await response.body?.cancel().catch(() => undefined); return }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        if (mounted.current) setFailure(response.status === 409 ? 'pending' : response.status === 503 ? 'unavailable'
          : response.status === 403 || response.status === 401 ? 'forbidden' : response.status === 404 ? 'notFound' : 'generic')
        return
      }
      const data = await readPdf(response, invoice.invoiceNo)
      if (!mounted.current || controller.signal.aborted) return
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
      const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url) }, 1000)
      urls.current.set(url, timer)
      const link = document.createElement('a')
      link.href = url
      link.download = invoice.invoiceNo + '.pdf'
      document.body.append(link)
      try { link.click() } finally { link.remove() }
      setStarted(true)
    } catch {
      if (mounted.current) setFailure('generic')
    } finally {
      clearTimeout(timeout)
      request.current = null
      inFlight.current = false
      if (mounted.current) setPending(false)
    }
  }

  const date = invoice?.issuedAt && Number.isFinite(new Date(invoice.issuedAt).getTime()) ? invoice.issuedAt : null
  const statusKey = invoice?.pdfStatus === 'READY' ? 'ready' : invoice?.pdfStatus === 'FAILED' ? 'unavailable'
    : invoice ? 'processing' : 'notIssued'
  return <section data-testid="order-invoice" aria-labelledby="order-invoice-heading" className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
    <h2 id="order-invoice-heading" className="text-lg font-semibold">{t('title')}</h2>
    <p className="text-sm text-gray-600">{t(statusKey)}</p>
    {invoice && <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div className="min-w-0"><dt className="text-gray-600">{t('invoiceNumber')}</dt><dd className="mt-1 break-all font-semibold">{validNumber(invoice.invoiceNo) ? invoice.invoiceNo : t('notAvailable')}</dd></div>
      <div><dt className="text-gray-600">{t('issuedAt')}</dt><dd className="mt-1">{date ? <time dateTime={date}>{formatKLDateTime(date, locale)} (Asia/Kuala_Lumpur)</time> : t('notAvailable')}</dd></div>
    </dl>}
    {failure && <p role="alert" className="text-sm text-red-800">{t(failureKey[failure])}</p>}
    {started && <p role="status" className="text-sm text-green-800">{t('downloadStarted')}</p>}
    <div className="flex flex-wrap items-center gap-4">
      {invoice?.pdfStatus === 'READY' && <Button type="button" onClick={download} disabled={!hydrated || pending} aria-busy={pending} className="h-auto min-h-11 whitespace-normal">{t('download')}</Button>}
      {pending && <span role="status" className="text-sm text-gray-600">{t('downloading')}</span>}
      <a href={'/' + locale + '/e/billing/' + encodeURIComponent(orderId)} className="inline-flex min-h-11 items-center text-sm text-blue-700 underline">{t('refresh')}</a>
    </div>
  </section>
}
