// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../messages/zh.json'
import en from '../../messages/en.json'
import OnboardingWizard from '@/components/onboarding/OnboardingWizard'
import { ApplyModal } from '@/components/apply/ApplyModal'
import { InvitationList } from '@/components/invitations/InvitationList'

const mocks = vi.hoisted(() => ({
  save: vi.fn(), contact: vi.fn(), complete: vi.fn(), push: vi.fn(), refresh: vi.fn(),
  resumes: vi.fn(), accept: vi.fn(), apply: vi.fn(),
}))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('@/server/actions/onboarding', () => ({
  saveStep1Action: mocks.save, saveStep2Action: mocks.save, saveStep3Action: mocks.save, saveStep4Action: mocks.save,
  saveStep1DraftAction: mocks.save, saveStep2DraftAction: mocks.save, saveStep3DraftAction: mocks.save, saveStep4DraftAction: mocks.save,
  completeOnboardingAction: mocks.complete,
}))
vi.mock('@/server/actions/contact', () => ({ updateOwnContactAction: mocks.contact }))
vi.mock('@/server/actions/resume', () => ({ setPrimaryResume: vi.fn(), deleteResume: vi.fn(), getOwnResumesAction: mocks.resumes }))
vi.mock('@/server/actions/applications', () => ({ applyToJobAction: mocks.apply, withdrawApplicationAction: vi.fn() }))
vi.mock('@/server/actions/invitations', () => ({ acceptInvitationAction: mocks.accept, declineInvitationAction: vi.fn() }))

let root: Root
let container: HTMLDivElement
const previousAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
afterAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct) })
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  mocks.save.mockResolvedValue({ ok: true, data: {} })
  mocks.contact.mockResolvedValue({ ok: true, data: {} })
  mocks.complete.mockResolvedValue({ ok: true, data: {} })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const contact = { phone: null, email: null, whatsapp: null, wechat: null, linkedinUrl: null }
const profile = {
  id: 'student', editRevision: 0, fullName: 'Student', workAuth: 'STUDENT_PASS',
  onboardingStep: 5, languages: [], educations: [], experiences: [],
} as unknown as ComponentProps<typeof OnboardingWizard>['profile']

async function wizard(step = 5, locale: 'zh' | 'en' = 'zh') {
  const props = { locale, initialStep: step, profile, schools: [], contact, resumes: [] }
  const providerProps = {
    locale, messages: locale === 'zh' ? zh : en, timeZone: 'Asia/Kuala_Lumpur',
    children: createElement(OnboardingWizard, props),
  }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
}
function button(label: string) {
  const result = Array.from(container.querySelectorAll('button')).find(b => b.textContent === label)
  if (!result) throw new Error('Missing button: ' + label)
  return result
}
async function enterEmail(value: string) {
  const input = container.querySelector<HTMLInputElement>('#contact-email')
  if (!input) throw new Error('Contact fields are missing from onboarding')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('onboarding application materials', () => {
  it('advances from experience to a fifth step before leaving onboarding', async () => {
    await wizard(4)
    await act(async () => Array.from(container.querySelectorAll('button')).at(-1)!.click())
    expect(container.textContent).toContain('第 5 / 5 步')
    expect(container.querySelector('#contact-email')).not.toBeNull()
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('saves contact edits when saving and exiting the fifth step', async () => {
    await wizard()
    await enterEmail('student@example.test')
    await act(async () => button('保存并退出').click())
    expect(mocks.contact).toHaveBeenCalledWith({ ...contact, email: 'student@example.test' })
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.push).toHaveBeenCalledWith('/s')
  })

  it('stays on the form when saving contact fails', async () => {
    mocks.contact.mockResolvedValue({ ok: false, code: 'VALIDATION_ERROR' })
    await wizard()
    await enterEmail('student@example.test')
    await act(async () => button('保存并退出').click())
    expect(mocks.push).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy()
  })

  it.each(['zh', 'en'] as const)('explains that a resume is required when finishing (%s)', async (locale) => {
    mocks.complete.mockResolvedValue({ ok: false, code: 'RESUME_REQUIRED' })
    await wizard(5, locale)
    await enterEmail('student@example.test')
    await act(async () => button(locale === 'zh' ? '完成' : en.onboarding.finish).click())
    expect(mocks.complete).toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(locale === 'zh' ? /简历/ : /resume/i)
  })

  it('warns before leaving incomplete materials for later', async () => {
    await wizard()
    expect(container.textContent).toContain('暂不能投递')
  })

  it('updates the uploaded resume without refreshing away unsaved contact edits', async () => {
    const resume = { id: 'resume', fileName: 'uploaded.pdf', sizeBytes: 1000, pageCount: 1, isPrimary: true, createdAt: new Date() }
    mocks.resumes.mockResolvedValue({ ok: true, data: { resumes: [resume] } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ ok: true, resumeId: resume.id }) }))
    await wizard()
    await enterEmail('unsaved@example.test')
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [new File(['synthetic pdf'], 'uploaded.pdf', { type: 'application/pdf' })] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).toContain('uploaded.pdf')
    expect(container.querySelector<HTMLInputElement>('#contact-email')?.value).toBe('unsaved@example.test')
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })
})

it('shows an actionable application warning for missing contact and resume', async () => {
  const props = { jobId: 'job', resumes: [], locale: 'zh', incompleteStepPath: '/zh/s/onboarding', blocker: 'contactAndResume' as const }
  const providerProps = {
    locale: 'zh', messages: zh, timeZone: 'Asia/Kuala_Lumpur',
    children: createElement(ApplyModal, props),
  }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
  expect(container.textContent).toContain('联系方式和简历')
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/zh/s/onboarding')
})

it('explains missing resume when accepting an invitation and links to onboarding', async () => {
  mocks.accept.mockResolvedValue({ ok: false, code: 'RESUME_REQUIRED' })
  const invitations = [{
    id: 'invitation', status: 'SENT', message: null, expiresAt: new Date(), createdAt: new Date(),
    respondedAt: null, applicationId: null, job: null,
    company: { id: 'company', legalName: 'Synthetic company', displayNameZh: null, displayNameEn: null },
  }] as ComponentProps<typeof InvitationList>['invitations']
  const providerProps = {
    locale: 'zh', messages: zh, timeZone: 'Asia/Kuala_Lumpur',
    children: createElement(InvitationList, { invitations, locale: 'zh' }),
  }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
  await act(async () => button(zh.invitations.acceptButton).click())
  expect(container.querySelector('[role="status"]')?.textContent).toContain('PDF 简历')
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/zh/s/onboarding')
})

it('attaches the primary resume automatically and offers no resume-free option', async () => {
  mocks.apply.mockResolvedValue({ ok: true, data: { applicationId: 'application' } })
  const props = {
    jobId: 'job', locale: 'zh', incompleteStepPath: null,
    resumes: [
      { id: 'other', fileName: 'other.pdf', isPrimary: false },
      { id: 'primary', fileName: 'primary.pdf', isPrimary: true },
    ],
  }
  const providerProps = {
    locale: 'zh', messages: zh, timeZone: 'Asia/Kuala_Lumpur', children: createElement(ApplyModal, props),
  }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
  await act(async () => button(zh.publicJobs.applyButton).click())
  const select = document.querySelector<HTMLSelectElement>('#apply-resume')!
  expect(select.value).toBe('primary')
  expect(Array.from(select.options).every(option => !!option.value)).toBe(true)
  const submit = Array.from(document.querySelectorAll('button')).find(b => b.textContent === zh.publicJobs.applyDialogSubmit)!
  await act(async () => submit.click())
  expect(mocks.apply).toHaveBeenCalledWith({ jobId: 'job', resumeId: 'primary', coverNote: null })
})
