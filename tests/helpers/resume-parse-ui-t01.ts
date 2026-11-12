import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import { ResumeParsePanel, type ResumeParsePanelProps } from '@/components/resume/ResumeParsePanel'
import type { ResumeSuggestionV1 } from '@/server/schemas/resume-parsing'
import type { ResumeParseDraftDto } from '@/server/services/resume-parsing'

export const resumeId = 'c' + '1'.repeat(24)
export const secondResumeId = 'c' + '2'.repeat(24)
export const groups = ['headline', 'summary', 'skills', 'languages', 'educations', 'experiences'] as const
export type Locale = 'zh' | 'en'
export const messages = (locale: Locale) => locale === 'zh' ? zh : en
export const current: ResumeSuggestionV1 = {
  headline: 'Existing headline', summary: 'Existing summary', skills: ['Existing skill'],
  languages: [{ language: 'Existing language', level: 'BASIC' }],
  educations: [{ schoolName: 'Existing school', degreeLevel: 'BACHELOR', major: null, startDate: null, endDate: null, gpa: null, description: null }],
  experiences: [{ kind: 'WORK', title: 'Existing role', organization: null, startDate: null, endDate: null, description: null }],
}
export const suggestion: ResumeSuggestionV1 = {
  headline: 'Suggested headline', summary: '<img src=x onerror=alert(1)> Synthetic summary', skills: ['Suggested skill'],
  languages: [{ language: 'English', level: 'FLUENT' }],
  educations: [{ schoolName: 'Synthetic school', degreeLevel: 'MASTER', major: 'Testing', startDate: '2020-01-01T00:00:00.000Z', endDate: null, gpa: null, description: 'Synthetic education' }],
  experiences: [{ kind: 'PROJECT', title: 'Synthetic project', organization: 'Synthetic org', startDate: null, endDate: null, description: 'Synthetic work' }],
}
export function ready(overrides: Partial<ResumeParseDraftDto> = {}): ResumeParseDraftDto {
  return { resumeId, generation: 2, state: 'READY', payload: structuredClone(suggestion), currentProfile: structuredClone(current),
    profileRevision: 7, failureCode: null, requestedAt: '2026-11-10T01:00:00.000Z', completedAt: '2026-11-10T01:01:00.000Z', confirmedAt: null,
    source: { fileName: 'SYNTHETIC 履历.pdf', createdAt: '2026-11-10T00:00:00.000Z' }, ...overrides }
}
export const props: ResumeParsePanelProps = {
  locale: 'en', resumes: [{ id: resumeId, fileName: 'SYNTHETIC 履历.pdf', createdAt: '2026-11-10T00:00:00.000Z' }],
  uiState: { available: true, consentGranted: true, legalVersion: 'synthetic-policy-v1' },
}
let root: Root | undefined
let container: HTMLDivElement | undefined
export async function mount(locale: Locale, overrides: Partial<ResumeParsePanelProps> = {}) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await rerender(locale, overrides)
}
export async function rerender(locale: Locale, overrides: Partial<ResumeParsePanelProps> = {}) {
  const providerProps = {
    locale, messages: messages(locale), timeZone: 'Asia/Kuala_Lumpur',
    children: createElement(ResumeParsePanel, { ...props, locale, ...overrides }),
  }
  await act(async () => root!.render(createElement(NextIntlClientProvider, providerProps)))
}
export async function unmount() { if (root) await act(async () => root!.unmount()); container?.remove(); root = undefined }
export function button(text: string, scope: ParentNode = document) {
  const result = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)
  if (!result) throw new Error('Missing expected button: ' + text)
  return result
}
export function group(name: string) { return document.querySelector<HTMLElement>('[data-testid="parse-group-' + name + '"]')! }
export async function click(element: HTMLElement) { await act(async () => element.click()) }
export async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
export async function selectGroup(name: string) { await click(group(name).querySelector<HTMLInputElement>('input[type="checkbox"]')!) }
