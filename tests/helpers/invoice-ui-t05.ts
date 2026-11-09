import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'

export type Locale = 'zh' | 'en'
export function messages(locale: Locale) { return locale === 'zh' ? zh : en }
export const invoice = {
  id: 'c' + 'a'.repeat(24), invoiceNo: 'FMJ-INV-00000001',
  issuedAt: '2026-11-10T01:02:03.000Z', pdfStatus: 'READY' as const,
}
export const orderId = 'c' + 'b'.repeat(24)
export const pdf = new TextEncoder().encode('%PDF-1.7\nsynthetic local fixture\n%%EOF')
export const privateText = 'PRIVATE_STORAGE_KEY_ISSUER_SNAPSHOT'
let root: Root
let container: HTMLDivElement
let active = false
export function setupUi() {
  const previous = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
  afterAll(() => { if (previous === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous) })
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); active = true })
  afterEach(async () => { await unmount(); container.remove() })
}
export async function unmount() { if (active) { await act(async () => root.unmount()); active = false } }
export async function mount(locale: Locale, child: ReactNode) {
  const props = { locale, messages: messages(locale), timeZone: 'Asia/Kuala_Lumpur', children: child }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
export async function click(node: HTMLElement) { await act(async () => node.click()) }
export function downloadButton(locale: Locale) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((node) => node.textContent === messages(locale).billingInvoice.download)
  if (!button) throw new Error('Invoice download button missing')
  return button
}
export function response(options: { status?: number; chunks?: Uint8Array[]; headers?: Record<string, string>; omitLength?: boolean; cancel?: () => void } = {}) {
  const chunks = options.chunks ?? [pdf]
  const headers: Record<string, string> = {
    'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="' + invoice.invoiceNo + '.pdf"',
    'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store',
    ...(!options.omitLength ? { 'content-length': String(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)) } : {}),
    ...options.headers,
  }
  let index = 0
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close() },
    cancel() { options.cancel?.() },
  }), { status: options.status ?? 200, headers })
}
