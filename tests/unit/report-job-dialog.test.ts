// @vitest-environment jsdom
/**
 * M7-T09 contract: named ReportJobDialog({jobId}) from
 * @/components/jobs/report-job-dialog; calls @/server/actions/reports#createReportAction.
 * Real next-intl + Radix UI; only the server action/navigation boundary is mocked.
 * Native select[name=reason], textarea[name=note], and a form; five reason enum values.
 * Success closes the dialog and announces role=status outside it. Action errors and
 * rejected requests stay in the dialog, preserve fields, and show localized role=alert.
 * Apply only after M6 is committed and M7 messages/actions/component exist.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../messages/zh.json'
import en from '../../messages/en.json'
import type { ActionResult } from '@/server/action'

const createReportAction = vi.hoisted(() => vi.fn())
vi.mock('@/server/actions/reports', () => ({ createReportAction }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

import { ReportJobDialog } from '@/components/jobs/report-job-dialog'

const COPY = {
  zh: {
    trigger: '举报职位', reason: '举报原因', note: '补充说明（可选）',
    submit: '提交举报', submitting: '正在提交…', cancel: '取消',
    success: '举报已收到，感谢你帮助维护求职安全。',
    reasons: ['要求先交钱', '虚假薪资', '疑似非法工作', '信息与实际不符', '其他'],
    errors: {
      VALIDATION_ERROR: '请选择有效原因，说明不得超过 1000 字。',
      RATE_LIMITED: '今天的举报次数已用完，请明天再试。',
      NOT_FOUND: '这个职位已不可用，无法提交举报。',
      FORBIDDEN: '当前会话无法提交举报，请重新登录。',
      INTERNAL_ERROR: '提交失败，请稍后重试。',
    },
  },
  en: {
    trigger: 'Report job', reason: 'Report reason', note: 'Additional details (optional)',
    submit: 'Submit report', submitting: 'Submitting…', cancel: 'Cancel',
    success: 'Report received. Thank you for helping keep job searches safe.',
    reasons: ['Payment requested upfront', 'False salary', 'Suspected illegal work', 'Listing does not match reality', 'Other'],
    errors: {
      VALIDATION_ERROR: 'Select a valid reason and keep the details within 1000 characters.',
      RATE_LIMITED: "You have reached today's report limit. Please try again tomorrow.",
      NOT_FOUND: 'This job is no longer available and cannot be reported.',
      FORBIDDEN: 'Your session cannot submit this report. Please sign in again.',
      INTERNAL_ERROR: 'Could not submit the report. Please try again later.',
    },
  },
} as const
const REASONS = ['ASKS_PAYMENT', 'FAKE_SALARY', 'ILLEGAL_WORK', 'MISMATCH', 'OTHER'] as const
const jobId = 'synthetic-report-job'
let root: Root
let container: HTMLDivElement
const oldActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')

beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
afterAll(() => {
  if (oldActEnvironment === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldActEnvironment)
})
beforeEach(() => {
  vi.clearAllMocks()
  createReportAction.mockReset()
  createReportAction.mockResolvedValue({ ok: true, data: { reportId: 'synthetic-report' } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const result = Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))
    .find((element) => element.textContent?.trim() === text)
  if (!result) throw new Error('Button not found: ' + text)
  return result
}

function dialog(): HTMLElement {
  const result = document.querySelector<HTMLElement>('[role=dialog]')
  if (!result) throw new Error('Report dialog is not open')
  return result
}

async function mount(locale: keyof typeof COPY) {
  const providerProps = {
    locale, messages: locale === 'zh' ? zh : en, timeZone: 'Asia/Kuala_Lumpur',
    children: createElement(ReportJobDialog, { jobId }),
  }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
  await act(async () => button(COPY[locale].trigger).click())
}

async function enter(reason: typeof REASONS[number], note: string) {
  const select = dialog().querySelector<HTMLSelectElement>('select[name=reason]')!
  const textarea = dialog().querySelector<HTMLTextAreaElement>('textarea[name=note]')!
  await act(async () => {
    select.value = reason
    select.dispatchEvent(new Event('change', { bubbles: true }))
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, note)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  const form = dialog().querySelector('form')!
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}

for (const locale of ['zh', 'en'] as const) {
  describe(locale + ' ReportJobDialog', () => {
    const c = COPY[locale]
    it('exposes exactly five translated choices and associated labels', async () => {
      await mount(locale)
      const select = dialog().querySelector<HTMLSelectElement>('select[name=reason]')!
      const textarea = dialog().querySelector<HTMLTextAreaElement>('textarea[name=note]')!
      const options = Array.from(select.options).filter((option) => option.value !== '')
      expect(options.map((option) => option.value)).toEqual([...REASONS])
      expect(options.map((option) => option.textContent)).toEqual([...c.reasons])
      expect(select.labels?.[0].textContent).toBe(c.reason)
      expect(textarea.labels?.[0].textContent).toBe(c.note)
      expect(textarea.maxLength).toBe(1000)
      expect(dialog().getAttribute('aria-labelledby')).toBeTruthy()
      expect(dialog().getAttribute('aria-describedby')).toBeTruthy()
    })

    it.each(Object.keys(c.errors) as (keyof typeof c.errors)[])(
      'preserves reason/note and shows the localized %s error', async (code) => {
        createReportAction.mockResolvedValueOnce({ ok: false, code })
        await mount(locale)
        await enter('MISMATCH', 'synthetic details')
        await submit()
        expect(dialog().querySelector('[role=alert]')?.textContent).toBe(c.errors[code])
        expect(dialog().querySelector<HTMLSelectElement>('select[name=reason]')?.value).toBe('MISMATCH')
        expect(dialog().querySelector<HTMLTextAreaElement>('textarea[name=note]')?.value).toBe('synthetic details')
        expect(button(c.submit, dialog()).disabled).toBe(false)
        expect(document.body.textContent).not.toContain(c.success)
        expect(createReportAction).toHaveBeenCalledTimes(1)
      },
    )

    it('handles rejected network calls without losing the form', async () => {
      createReportAction.mockRejectedValueOnce(new Error('synthetic network failure'))
      await mount(locale)
      await enter('FAKE_SALARY', 'preserve these details')
      await submit()
      expect(dialog().querySelector('[role=alert]')?.textContent).toBe(c.errors.INTERNAL_ERROR)
      expect(dialog().querySelector<HTMLTextAreaElement>('textarea[name=note]')?.value).toBe('preserve these details')
      expect(dialog().querySelector<HTMLSelectElement>('select[name=reason]')?.value).toBe('FAKE_SALARY')
      expect(button(c.submit, dialog()).disabled).toBe(false)
    })

    it('disables the pending submission and only announces success after resolution', async () => {
      let finish!: (value: ActionResult<{ reportId: string }>) => void
      createReportAction.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
      await mount(locale)
      await enter('OTHER', '')
      await submit()
      const pendingButton = button(c.submitting, dialog())
      expect(pendingButton.disabled).toBe(true)
      await act(async () => pendingButton.click())
      expect(createReportAction).toHaveBeenCalledTimes(1)
      expect(document.body.textContent).not.toContain(c.success)
      await act(async () => finish({ ok: true, data: { reportId: 'synthetic-report' } }))
      expect(document.querySelector('[role=dialog]')).toBeNull()
      expect(document.querySelector('[role=status]')?.textContent).toBe(c.success)
    })
  })
}

describe('ReportJobDialog action payload', () => {
  it.each(REASONS)('submits %s from the form with the job ID and trimmed note', async (reason) => {
    await mount('en')
    await enter(reason, '  synthetic details  ')
    await submit()
    expect(createReportAction).toHaveBeenCalledTimes(1)
    expect(createReportAction).toHaveBeenCalledWith({ jobId, reason, note: 'synthetic details' })
    expect(document.querySelector('[role=dialog]')).toBeNull()
  })

  it('allows OTHER without a note', async () => {
    await mount('en')
    await enter('OTHER', '')
    await submit()
    expect(createReportAction).toHaveBeenCalledWith(expect.objectContaining({ jobId, reason: 'OTHER' }))
    expect(document.querySelector('[role=status]')?.textContent).toBe(COPY.en.success)
  })

  it('does not send an action when the user cancels', async () => {
    await mount('en')
    await enter('OTHER', 'not submitted')
    await act(async () => button(COPY.en.cancel, dialog()).click())
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(createReportAction).not.toHaveBeenCalled()
  })
})
