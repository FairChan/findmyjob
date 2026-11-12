import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'

export type Locale = 'zh' | 'en'
export function messages(locale: Locale) { return locale === 'zh' ? zh : en }
// Frozen presentation shape from the coordinator; no internal order/snapshot IDs.
export interface Usage {
  source: 'SUBSCRIPTION' | 'FREE' | 'PILOT'
  effectiveUntil: string | null
  jobs: { used: number; limit: number | null }
  seats: { used: number; reserved: number; limit: number | null }
  invitations: { used: number; limit: number | null }
  canPurchase: boolean
}
export function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    source: 'FREE', effectiveUntil: null, jobs: { used: 5, limit: 2 },
    seats: { used: 8, reserved: 2, limit: 3 }, invitations: { used: 50, limit: 20 },
    canPurchase: true, ...overrides,
  }
}
let root: Root
let container: HTMLDivElement
export function setupUi() {
  const previous = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
  afterAll(() => {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous)
  })
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })
}
export async function mount(locale: Locale, child: ReactNode) {
  const props = { locale, messages: messages(locale), timeZone: 'Asia/Kuala_Lumpur', children: child }
  await act(async () => root.render(createElement(NextIntlClientProvider, props)))
}
export function button(label: string) {
  const result = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === label)
  if (!result) throw new Error('Button not found: ' + label)
  return result
}
export async function click(element: HTMLElement) { await act(async () => element.click()) }
export async function submit(form: HTMLFormElement) {
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
export async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
export async function select(element: HTMLSelectElement, value: string) {
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })) })
}
export function jobLabels(locale: Locale) {
  const t = messages(locale).jobs
  return {
    ...t.form, typeInternship: t.type.INTERNSHIP, typeFullTime: t.type.FULL_TIME, typePartTime: t.type.PART_TIME,
    workModeOnsite: t.workMode.ONSITE, workModeHybrid: t.workMode.HYBRID, workModeRemote: t.workMode.REMOTE,
    errorForbidden: t.errorForbidden, errorUnknown: t.errorUnknown,
  }
}
