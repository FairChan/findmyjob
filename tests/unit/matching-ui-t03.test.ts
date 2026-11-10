// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentMatchingPanel } from '@/components/matching/StudentMatchingPanel'
import { EmployerMatchingPanel } from '@/components/matching/EmployerMatchingPanel'
import { button, click, copy, granted, job, jobId, profileId, render, state, talent, unmount } from '../helpers/matching-ui-t03'
const io = vi.hoisted(() => ({ jobs: vi.fn(), talents: vi.fn(), consent: vi.fn(), refresh: vi.fn() }))
vi.mock('@/server/actions/semantic-matching', () => ({ recommendJobsAction: io.jobs, recommendTalentsAction: io.talents, setMatchingConsentAction: io.consent }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: io.refresh }) }))
vi.mock('next/link', () => ({ default: ({ children, href, prefetch, ...rest }: { children: import('react').ReactNode; href: string; prefetch?: boolean }) =>
  createElement('a', { ...rest, href, 'data-prefetch': String(prefetch) }, children) }))
const oldAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
afterAll(() => { if (oldAct === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldAct) })
beforeEach(() => {
  vi.resetAllMocks()
  io.jobs.mockResolvedValue({ ok: true, data: { availability: 'ready', items: [job] } })
  io.talents.mockResolvedValue({ ok: true, data: { availability: 'ready', items: [talent] } })
  io.consent.mockResolvedValue({ ok: true, data: undefined })
})
afterEach(unmount)
for (const locale of ['zh', 'en'] as const) describe(locale + ' explicit AI matching', () => {
  const student = (uiState = state, consentOnly = false) => render(createElement(StudentMatchingPanel, { locale, uiState, consentOnly }), locale)
  const employer = () => render(createElement(EmployerMatchingPanel, { locale, job: { id: jobId, title: job.title } }), locale)
  it('keeps consent unchecked and requires a separate explicit request using only the current student profile', async () => {
    const t = copy(locale).matching
    await student()
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(false); expect(button(t.saveConsent).disabled).toBe(true)
    expect(button(t.requestJobs).disabled).toBe(true); expect(io.jobs).not.toHaveBeenCalled()
    await click(checkbox); await click(button(t.saveConsent))
    expect(io.consent).toHaveBeenCalledExactlyOnceWith({ granted: true, submittedVersion: 'synthetic-v1' })
    expect(io.jobs).not.toHaveBeenCalled()
    await click(button(t.requestJobs))
    expect(io.jobs).toHaveBeenCalledExactlyOnceWith({ limit: 10 })
    expect(document.body.textContent).toContain(job.title)
    const detail = document.querySelector('a[href="/' + locale + '/jobs/' + jobId + '"]')
    expect(detail?.getAttribute('data-prefetch')).toBe('false')
  })
  it('keeps independent consent management in privacy mode without any recommendation request control', async () => {
    const t = copy(locale).matching
    await student(state, true)
    expect(document.body.textContent).toContain(t.disclosure)
    expect(document.body.textContent).not.toContain(t.requestJobs)
    await click(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button(t.saveConsent))
    expect(io.jobs).not.toHaveBeenCalled(); expect(io.talents).not.toHaveBeenCalled()
    expect(io.consent).toHaveBeenCalledOnce()
  })
  it('offers withdrawal with disabled gate and null policy without fabricating a version', async () => {
    const t = copy(locale).matching
    await student({ ...granted, available: false, consentCurrent: false, legalVersion: null })
    expect(button(t.requestJobs).disabled).toBe(true)
    expect(document.querySelector('a[href="/' + locale + '/jobs"]')).not.toBeNull()
    await click(button(t.withdraw))
    expect(io.consent).toHaveBeenCalledExactlyOnceWith({ granted: false, submittedVersion: null })
    expect(document.body.textContent).toContain(t.consentWithdrawn)
    expect(io.jobs).not.toHaveBeenCalled()
  })
  it('distinguishes unavailable from ready empty while keeping ordinary search', async () => {
    const t = copy(locale).matching
    io.jobs.mockResolvedValueOnce({ ok: true, data: { availability: 'unavailable', items: [] } })
      .mockResolvedValueOnce({ ok: true, data: { availability: 'ready', items: [] } })
    await student(granted); await click(button(t.requestJobs))
    expect(document.body.textContent).toContain(t.unavailable)
    expect(document.body.textContent).not.toContain(t.empty)
    await click(button(t.requestJobs))
    expect(document.body.textContent).toContain(t.empty)
    expect(document.querySelector('a[href="/' + locale + '/jobs"]')?.textContent).toBe(t.searchJobs)
  })
  it('renders only job-card fields as plain text and ignores extra sensitive data', async () => {
    const t = copy(locale).matching
    io.jobs.mockResolvedValue({ ok: true, data: { availability: 'ready', items: [{ ...job, title: '<img src=x onerror=alert(1)>',
      score: 'PRIVATE_SCORE', vector: ['PRIVATE_VECTOR'], explanation: 'PRIVATE_EXPLANATION', contact: 'PRIVATE_CONTACT', description: 'PRIVATE_DESCRIPTION' }] } })
    await student(granted); await click(button(t.requestJobs))
    expect(document.querySelector('img')).toBeNull()
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(document.body.textContent).not.toMatch(/PRIVATE_SCORE|PRIVATE_VECTOR|PRIVATE_EXPLANATION|PRIVATE_CONTACT|PRIVATE_DESCRIPTION/)
  })
  it('clears cards and requires new unchecked consent after a policy mismatch', async () => {
    const t = copy(locale).matching
    await student(granted); await click(button(t.requestJobs))
    io.jobs.mockResolvedValue({ ok: false, code: 'VERSION_MISMATCH', message: 'PRIVATE_ERROR' })
    await click(button(t.requestJobs))
    expect(document.body.textContent).not.toContain(job.title)
    expect(document.body.textContent).not.toContain('PRIVATE_ERROR')
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    expect(button(t.requestJobs).disabled).toBe(true)
    expect(button(t.withdraw).disabled).toBe(false)
    expect(io.refresh).toHaveBeenCalledOnce()
  })
  it('requests talents for only its owned source and preserves masked identity and metered links', async () => {
    const t = copy(locale).matching
    io.talents.mockResolvedValue({ ok: true, data: { availability: 'ready', items: [{ ...talent, score: 'PRIVATE_SCORE', contact: 'PRIVATE_CONTACT', rawVector: ['PRIVATE_VECTOR'] }] } })
    await employer(); expect(io.talents).not.toHaveBeenCalled()
    await click(button(t.requestTalent))
    expect(io.talents).toHaveBeenCalledExactlyOnceWith({ jobId, limit: 10 })
    expect(document.body.textContent).toContain(talent.name)
    expect(document.body.textContent).not.toMatch(/PRIVATE_SCORE|PRIVATE_VECTOR|PRIVATE_CONTACT/)
    expect(document.querySelector('a[href="/' + locale + '/e/talent/' + profileId + '"]')?.getAttribute('data-prefetch')).toBe('false')
    expect(document.querySelector('a[href="/' + locale + '/e/talent"]')?.getAttribute('data-prefetch')).toBe('false')
  })
  it('clears stale employer cards on quota failure and retains ordinary search', async () => {
    const t = copy(locale).matching
    await employer(); await click(button(t.requestTalent))
    io.talents.mockResolvedValue({ ok: false, code: 'RATE_LIMITED', message: 'PRIVATE_PROVIDER_ERROR' })
    await click(button(t.requestTalent))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(t.error.rateLimited)
    expect(document.body.textContent).not.toContain(talent.name)
    expect(document.body.textContent).not.toContain('PRIVATE_PROVIDER_ERROR')
    expect(document.querySelector('a[href="/' + locale + '/e/talent"]')).not.toBeNull()
  })
})
describe('matching asynchronous boundaries', () => {
  it('ignores a pending job result after withdrawal and allows withdrawal while inference is pending', async () => {
    const t = copy('en').matching
    let finish!: (value: unknown) => void
    io.jobs.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await render(createElement(StudentMatchingPanel, { locale: 'en', uiState: granted }))
    await click(button(t.requestJobs))
    expect(button(t.withdraw).disabled).toBe(false)
    await click(button(t.withdraw))
    await act(async () => finish({ ok: true, data: { availability: 'ready', items: [job] } }))
    expect(document.body.textContent).not.toContain(job.title)
    expect(button(t.requestJobs).disabled).toBe(true)
    expect(io.consent).toHaveBeenCalledExactlyOnceWith({ granted: false, submittedVersion: 'synthetic-v1' })
  })
  it('prevents duplicate employer requests and reports thrown failures safely', async () => {
    const t = copy('en').matching
    let fail!: (error: Error) => void
    io.talents.mockReturnValue(new Promise((_, reject) => { fail = reject }))
    await render(createElement(EmployerMatchingPanel, { locale: 'en', job: { id: jobId, title: job.title } }))
    await act(async () => { button(t.requestTalent).click(); button(t.requestTalent).click() })
    expect(io.talents).toHaveBeenCalledOnce()
    await act(async () => fail(new Error('PRIVATE_THROWN_ERROR')))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(t.error.generic)
    expect(document.body.textContent).not.toContain('PRIVATE_THROWN_ERROR')
  })
  it('does not show a result from an old employer source after its props change', async () => {
    const t = copy('en').matching
    let finish!: (value: unknown) => void
    io.talents.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await render(createElement(EmployerMatchingPanel, { locale: 'en', job: { id: jobId, title: job.title } }))
    await click(button(t.requestTalent))
    await render(createElement(EmployerMatchingPanel, { locale: 'en', job: { id: 'c' + '9'.repeat(24), title: 'Other source' } }))
    await act(async () => finish({ ok: true, data: { availability: 'ready', items: [talent] } }))
    expect(document.body.textContent).not.toContain(talent.name)
    expect(document.body.textContent).toContain('Other source')
  })
  it('requires current-version permission again when server metadata changes without remounting', async () => {
    const t = copy('en').matching
    await render(createElement(StudentMatchingPanel, { locale: 'en', uiState: granted }))
    await click(button(t.requestJobs))
    await render(createElement(StudentMatchingPanel, { locale: 'en', uiState: { ...granted, legalVersion: 'synthetic-v2', consentCurrent: false } }))
    expect(button(t.requestJobs).disabled).toBe(true)
    expect(document.body.textContent).not.toContain(job.title)
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
  })
})
