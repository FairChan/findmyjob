// @vitest-environment jsdom
/**
 * Report-only M9-T02 UI contract. Real JobFormClient, JdAssistant, next-intl and
 * Radix; only generate action/navigation and the outer save boundary are mocked.
 * Apply messages + a compilable action/component baseline before observing RED.
 * This does not prove provider transport, server permissions or DB persistence.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../messages/zh.json'
import en from '../../messages/en.json'
import JobFormClient, { type JobFormData } from '@/components/jobs/job-form-client'

const generate = vi.hoisted(() => vi.fn())
vi.mock('@/server/actions/jd-assistant', () => ({ generateJobDescriptionAction: generate }))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const COPY = {
  zh: {
    trigger: 'AI 职位描述助手', generate: '生成建议', generating: '正在生成…', points: '岗位要点',
    zhLabel: '中文建议', enLabel: '英文建议', apply: '应用到职位描述', replace: '确认替换', keep: '保留原文', cancel: '取消',
    applied: '已填入职位描述，请检查后保存。', zhHeading: '中文职位描述', enHeading: 'English job description',
  },
  en: {
    trigger: 'AI job description assistant', generate: 'Generate suggestions', generating: 'Generating…', points: 'Role notes',
    zhLabel: 'Chinese suggestion', enLabel: 'English suggestion', apply: 'Apply to job description', replace: 'Confirm replacement', keep: 'Keep original text', cancel: 'Cancel',
    applied: 'Job description filled in. Review it before saving.', zhHeading: 'Chinese job description', enHeading: 'English job description',
  },
} as const
type Locale = keyof typeof COPY
type Output = { ok: true; data: { zh: string; en: string } } | { ok: false; code: string }
const VERSION = 'synthetic-jd-policy-v1'
const initial: JobFormData = {
  jobId: 'synthetic-job', title: 'Synthetic support intern', type: 'INTERNSHIP', category: 'Support',
  description: 'Original manual description', requirements: 'Original requirements', benefits: 'Original benefits',
  workMode: 'REMOTE', state: 'KUL', city: 'Kuala Lumpur', salaryMin: 1200, salaryMax: 1800,
  salaryVisible: false, languages: ['English'], skills: ['Writing'], acceptsStudentPass: false,
  sponsorsWorkPass: false, headcount: 2, updatedAt: '2026-01-01T00:00:00.000Z',
}
const generated = { zh: '合成中文建议', en: 'Synthetic English suggestion' }
let root: Root
let container: HTMLDivElement
let locale: Locale
let save: ReturnType<typeof vi.fn<ComponentProps<typeof JobFormClient>['onSaveOrSubmit']>>
const oldAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
afterAll(() => {
  if (oldAct === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldAct)
})
beforeEach(() => {
  generate.mockReset().mockResolvedValue({ ok: true, data: generated })
  save = vi.fn<ComponentProps<typeof JobFormClient>['onSaveOrSubmit']>().mockResolvedValue({ ok: true, data: { id: initial.jobId!, status: 'DRAFT' } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const value = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text)
  if (!value) throw new Error('Button not found: ' + text)
  return value
}
function field<T extends HTMLElement>(name: string): T {
  const value = document.querySelector<T>('[data-testid="jd-assistant-dialog"] [name="' + name + '"]')
  if (!value) throw new Error('Assistant field not found: ' + name)
  return value
}
function description(): HTMLTextAreaElement {
  const placeholder = (locale === 'zh' ? zh : en).jobs.form.descriptionPlaceholder
  const element = Array.from(container.querySelectorAll<HTMLTextAreaElement>('textarea')).find((item) => item.placeholder === placeholder)
  if (!element) throw new Error('Job description field not found')
  return element
}
async function click(element: HTMLButtonElement) { await act(async () => element.click()) }
async function enter(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function render(options: { language?: Locale; enabled?: boolean; editable?: boolean; version?: string; jobId?: string; mode?: 'create' | 'edit' } = {}) {
  locale = options.language ?? 'en'
  const messages = locale === 'zh' ? zh : en
  const j = messages.jobs
  // A spread permits the forthcoming optional prop while the existing form
  // compiles. The unmodified form ignores it and fails on missing UI behavior.
  const assistantProps = options.enabled === false ? {} : { jdAssistant: { submittedVersion: options.version ?? VERSION } }
  const props: ComponentProps<typeof JobFormClient> = {
    mode: options.mode ?? 'edit', isVerified: false, isEditable: options.editable ?? true,
    initialData: { ...initial, jobId: options.jobId ?? initial.jobId },
    onSaveOrSubmit: save, backHref: '/e/jobs', ...assistantProps,
    t: {
      ...j.form, typeInternship: j.type.INTERNSHIP, typeFullTime: j.type.FULL_TIME, typePartTime: j.type.PART_TIME,
      workModeOnsite: j.workMode.ONSITE, workModeHybrid: j.workMode.HYBRID, workModeRemote: j.workMode.REMOTE,
      errorForbidden: j.errorForbidden, errorUnknown: j.errorUnknown,
    },
  }
  const providerProps = {
    locale, messages, timeZone: 'Asia/Kuala_Lumpur', children: createElement(JobFormClient, props),
  }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
}
async function open() { await click(button(COPY[locale].trigger)) }
async function prepare() {
  await enter(field<HTMLTextAreaElement>('points'), '  Synthetic support duties  ')
  const acknowledgement = field<HTMLInputElement>('acknowledged')
  if (!acknowledgement.checked) await act(async () => acknowledgement.click())
}
async function generateNow() { await prepare(); await click(button(COPY[locale].generate)) }
function combined(chinese: string, english: string) {
  return COPY[locale].zhHeading + '\n' + chinese + '\n\n' + COPY[locale].enHeading + '\n' + english
}
function deferred() {
  let finish!: (value: Output) => void
  const promise = new Promise<Output>((resolve) => { finish = resolve })
  return { promise, finish }
}

for (const language of ['zh', 'en'] as const) {
  describe(language + ' JD assistant inside the real job editor', () => {
    it('labels bounded fields, requires acknowledgement and never nests a form or submits it', async () => {
      await render({ language }); await open()
      const points = field<HTMLTextAreaElement>('points')
      expect(points.labels?.[0].textContent).toBe(COPY[language].points)
      expect(points.maxLength).toBe(3000)
      expect(field<HTMLInputElement>('acknowledged').checked).toBe(false)
      await enter(points, 'Synthetic duties')
      await click(button(COPY[language].generate))
      expect(generate).not.toHaveBeenCalled()
      await generateNow()
      expect(generate).toHaveBeenCalledWith({ title: initial.title, points: 'Synthetic support duties', acknowledged: true, submittedVersion: VERSION })
      expect(field<HTMLInputElement>('acknowledged').checked).toBe(false)
      for (const [name, label] of [['zh', COPY[language].zhLabel], ['en', COPY[language].enLabel]]) {
        const input = field<HTMLTextAreaElement>(name)
        expect(input.labels?.[0].textContent).toBe(label)
        expect(input.maxLength).toBe(4000)
      }
      expect(document.querySelector('form form')).toBeNull()
      expect(Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="jd-assistant-dialog"] button')).every((item) => item.type === 'button')).toBe(true)
      expect(description().value).toBe(initial.description)
      expect(save).not.toHaveBeenCalled()
    })

    it('keeps replacement cancellable, applies only description, then uses the original draft save', async () => {
      await render({ language }); await open(); await generateNow()
      const editedZh = '人工核对后的中文建议'
      const editedEn = 'Human-reviewed English suggestion'
      await enter(field<HTMLTextAreaElement>('zh'), editedZh)
      await enter(field<HTMLTextAreaElement>('en'), editedEn)
      await click(button(COPY[language].apply))
      await click(button(COPY[language].keep))
      expect(description().value).toBe(initial.description)
      expect(field<HTMLTextAreaElement>('en').value).toBe(editedEn)
      await click(button(COPY[language].apply))
      await click(button(COPY[language].replace))
      expect(description().value).toBe(combined(editedZh, editedEn))
      expect(document.querySelector('[data-testid="jd-assistant-feedback"]')?.textContent).toBe(COPY[language].applied)
      await expect.poll(() => document.activeElement === description()).toBe(true)
      expect(save).not.toHaveBeenCalled()
      await click(button((language === 'zh' ? zh : en).jobs.form.saveDraft, container))
      expect(save).toHaveBeenCalledTimes(1)
      expect(save).toHaveBeenCalledWith(expect.objectContaining({
        ...initial, description: combined(editedZh, editedEn), submit: false,
      }))
      expect(generate).toHaveBeenCalledTimes(1)
    })

    it('keeps human text and role notes after an action failure and a rejected request', async () => {
      generate.mockResolvedValueOnce({ ok: false, code: 'RATE_LIMITED' }).mockRejectedValueOnce(new Error('synthetic provider exception must stay private'))
      await render({ language }); await open(); await generateNow()
      expect(document.querySelector('[data-testid="jd-assistant-dialog"] [role=alert]')).not.toBeNull()
      expect(field<HTMLTextAreaElement>('points').value.trim()).toBe('Synthetic support duties')
      expect(description().value).toBe(initial.description)
      await generateNow()
      expect(document.querySelector('[data-testid="jd-assistant-dialog"] [role=alert]')).not.toBeNull()
      expect(document.body.textContent).not.toContain('synthetic provider exception')
      expect(description().value).toBe(initial.description)
      expect(save).not.toHaveBeenCalled()
    })
  })
}

describe('JD assistant race and boundary guards', () => {
  it('hides the entry when disabled or when the existing editor is read-only', async () => {
    await render({ enabled: false })
    expect(document.body.textContent).not.toContain(COPY.en.trigger)
    await render({ editable: false })
    expect(document.body.textContent).not.toContain(COPY.en.trigger)
    expect(generate).not.toHaveBeenCalled()
  })

  it('sends one pending request and preserves a description edited while it is in flight', async () => {
    const response = deferred(); generate.mockReturnValueOnce(response.promise)
    await render(); await open(); await prepare()
    const trigger = button(COPY.en.generate)
    await act(async () => { trigger.click(); trigger.click() })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(button(COPY.en.generating).disabled).toBe(true)
    await enter(description(), 'New manual description during generation')
    await act(async () => response.finish({ ok: true, data: generated }))
    expect(description().value).toBe('New manual description during generation')
    await click(button(COPY.en.apply))
    expect(document.querySelector('[data-testid="jd-replace-current"]')?.textContent).toBe('New manual description during generation')
    await click(button(COPY.en.keep))
    expect(description().value).toBe('New manual description during generation')
    expect(save).not.toHaveBeenCalled()
  })

  it('reconfirms if the current text changes again while replacement confirmation is open', async () => {
    await render(); await open(); await generateNow(); await click(button(COPY.en.apply))
    await enter(description(), 'Newer text after replacement prompt')
    await click(button(COPY.en.replace))
    expect(description().value).toBe('Newer text after replacement prompt')
    expect(document.querySelector('[data-testid="jd-replace-current"]')?.textContent).toBe('Newer text after replacement prompt')
    expect(document.querySelector('[role=alert]')).not.toBeNull()
    await click(button(COPY.en.replace))
    expect(description().value).toBe(combined(generated.zh, generated.en))
    expect(save).not.toHaveBeenCalled()
  })

  it('invalidates a cancelled generation so an old response cannot fill a reopened dialog', async () => {
    const response = deferred(); generate.mockReturnValueOnce(response.promise)
    await render(); await open(); await generateNow()
    await click(button(COPY.en.cancel))
    await expect.poll(() => document.activeElement === button(COPY.en.trigger)).toBe(true)
    await open()
    await act(async () => response.finish({ ok: true, data: generated }))
    expect(document.querySelector<HTMLTextAreaElement>('[name=en]')?.value ?? '').toBe('')
    expect(description().value).toBe(initial.description)
    expect(save).not.toHaveBeenCalled()
  })

  it('discards pending output when the policy context changes', async () => {
    const response = deferred(); generate.mockReturnValueOnce(response.promise)
    await render(); await open(); await generateNow()
    await render({ version: 'synthetic-jd-policy-v2' })
    await act(async () => response.finish({ ok: true, data: generated }))
    expect(document.querySelector<HTMLTextAreaElement>('[name=en]')?.value ?? '').toBe('')
    expect(description().value).toBe(initial.description)
    expect(save).not.toHaveBeenCalled()
  })

  it('retains manually edited suggestions when a later generation fails', async () => {
    await render(); await open(); await generateNow()
    await enter(field<HTMLTextAreaElement>('zh'), '人工修订建议')
    await enter(field<HTMLTextAreaElement>('en'), 'Manually revised suggestion')
    generate.mockResolvedValueOnce({ ok: false, code: 'INTERNAL_ERROR' })
    await generateNow()
    expect(field<HTMLTextAreaElement>('zh').value).toBe('人工修订建议')
    expect(field<HTMLTextAreaElement>('en').value).toBe('Manually revised suggestion')
    expect(description().value).toBe(initial.description)
    expect(save).not.toHaveBeenCalled()
  })

  it('does not revive output after the editor is unmounted', async () => {
    const response = deferred(); generate.mockReturnValueOnce(response.promise)
    await render(); await open(); await generateNow()
    await act(async () => root.render(null))
    await act(async () => response.finish({ ok: true, data: generated }))
    expect(document.querySelector('[data-testid="jd-assistant-dialog"]')).toBeNull()
    expect(document.body.textContent).not.toContain(generated.en)
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects oversized suggestions but accepts 4000 characters per language without truncating', async () => {
    generate.mockResolvedValueOnce({ ok: true, data: { zh: '中'.repeat(4001), en: 'Valid synthetic English' } })
    await render(); await open(); await generateNow()
    expect(document.querySelector('[role=alert]')).not.toBeNull()
    expect(description().value).toBe(initial.description)
    generate.mockResolvedValueOnce({ ok: true, data: { zh: '中'.repeat(4000), en: 'E'.repeat(4000) } })
    await generateNow()
    await enter(field<HTMLTextAreaElement>('en'), 'E'.repeat(4001))
    await click(button(COPY.en.apply))
    expect(document.querySelector('[role=alert]')).not.toBeNull()
    expect(description().value).toBe(initial.description)
    await enter(field<HTMLTextAreaElement>('en'), 'E'.repeat(4000))
    await click(button(COPY.en.apply)); await click(button(COPY.en.replace))
    expect(description().value).toBe(combined('中'.repeat(4000), 'E'.repeat(4000)))
    expect(description().value.length).toBeLessThanOrEqual(10000)
    expect(save).not.toHaveBeenCalled()
  })
})
