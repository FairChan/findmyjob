import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterAll, beforeAll } from 'vitest'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import type { MarketingUiState } from '@/server/services/marketing-consent'

const oldAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
afterAll(() => {
  if (oldAct === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldAct)
})

export const copy = (locale: 'en' | 'zh') => locale === 'zh' ? zh : en
export const state: MarketingUiState = { available: true, consentGranted: false, legalVersion: 'synthetic-marketing-v1' }
let root: Root | undefined
let container: HTMLDivElement | undefined
export async function render(node: ReactNode, locale: 'en' | 'zh' = 'en') {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  const providerProps = { locale, messages: copy(locale), timeZone: 'Asia/Kuala_Lumpur', children: node }
  await act(async () => root!.render(createElement(NextIntlClientProvider, providerProps)))
}
export async function unmount() { if (root) await act(async () => root!.unmount()); container?.remove(); root = undefined }
export function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)
  if (!found) throw new Error('Missing button: ' + label)
  return found
}
export function checkbox() { return document.querySelector<HTMLInputElement>('input[type="checkbox"]')! }
export async function click(element: HTMLElement) { await act(async () => element.click()) }
