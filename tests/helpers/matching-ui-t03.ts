import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import type { JobListItem } from '@/server/serializers/job'
import type { TalentCard } from '@/server/serializers/talent-card'
import type { StudentMatchingUiState } from '@/server/services/semantic-matching'
export const copy = (locale: 'en' | 'zh') => locale === 'zh' ? zh : en
export const jobId = 'c' + '3'.repeat(24)
export const profileId = 'c' + '4'.repeat(24)
export const state: StudentMatchingUiState = { available: true, consentGranted: false, consentCurrent: false, legalVersion: 'synthetic-v1' }
export const granted: StudentMatchingUiState = { ...state, consentGranted: true, consentCurrent: true }
export const job: JobListItem = {
  id: jobId, title: 'SYNTHETIC job', type: 'INTERNSHIP', category: 'Testing', workMode: 'HYBRID', state: 'KUL', city: 'Synthetic city',
  salaryMin: null, salaryMax: null, languages: ['English'], skills: ['Synthetic SQL'], acceptsStudentPass: true, sponsorsWorkPass: false,
  headcount: 1, deadline: null, publishedAt: null, company: { id: 'synthetic-company', displayNameZh: '合成企业', displayNameEn: 'Synthetic company', legalName: 'Synthetic legal company' },
}
export const talent: TalentCard = { id: profileId, name: '合**', unlocked: false, school: null, major: 'Testing', degreeLevel: 'BACHELOR',
  graduationYear: 2027, cgpa: null, skills: ['Synthetic SQL'], headline: 'Synthetic headline', completeness: 90, workAuth: 'STUDENT_PASS', lastActiveAt: null }
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
export async function click(element: HTMLElement) { await act(async () => element.click()) }
