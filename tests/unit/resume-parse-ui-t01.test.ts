// @vitest-environment jsdom
import { act } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { button, click, current, group, groups, input, messages, mount, props, ready, rerender, resumeId, secondResumeId, selectGroup, unmount } from '../helpers/resume-parse-ui-t01'

const io = vi.hoisted(() => ({ consent: vi.fn(), request: vi.fn(), read: vi.fn(), confirm: vi.fn(), discard: vi.fn(), refresh: vi.fn() }))
vi.mock('@/server/actions/resume-parsing', () => ({
  setResumeParseConsentAction: io.consent, requestResumeParseAction: io.request, getResumeParseDraftAction: io.read,
  confirmResumeParseAction: io.confirm, discardResumeParseDraftAction: io.discard,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: io.refresh }) }))
const oldAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
beforeAll(() => { Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true) })
afterAll(() => { if (oldAct === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldAct) })
beforeEach(() => {
  vi.resetAllMocks()
  io.consent.mockResolvedValue({ ok: true, data: { granted: true, version: 'synthetic-policy-v1' } })
  io.request.mockResolvedValue({ ok: true, data: { resumeId, generation: 3, state: 'QUEUED', dispatch: 'pending' } })
  io.read.mockResolvedValue({ ok: true, data: ready() })
  io.confirm.mockResolvedValue({ ok: true, data: { appliedProfileRevision: 8, alreadyApplied: false } })
  io.discard.mockResolvedValue({ ok: true, data: undefined })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(async () => { await unmount(); vi.restoreAllMocks() })

for (const locale of ['zh', 'en'] as const) {
  describe(locale + ' private resume review', () => {
    it('requires separate unchecked consent and a later explicit parse request', async () => {
      const t = messages(locale).resumeParse
      io.read.mockResolvedValueOnce({ ok: true, data: null }).mockResolvedValue({ ok: true, data: ready({ state: 'QUEUED', payload: null, currentProfile: null }) })
      await mount(locale, { uiState: { ...props.uiState, consentGranted: false } })
      expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
      expect(button(t.saveConsent).disabled).toBe(true)
      expect(button(t.request).disabled).toBe(true)
      expect(io.read).not.toHaveBeenCalled(); expect(io.request).not.toHaveBeenCalled()
      await click(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!)
      await click(button(t.saveConsent))
      expect(io.consent).toHaveBeenCalledExactlyOnceWith({ granted: true, submittedVersion: 'synthetic-policy-v1' })
      expect(io.request).not.toHaveBeenCalled(); expect(io.confirm).not.toHaveBeenCalled()
      await click(button(t.request))
      expect(io.request).toHaveBeenCalledExactlyOnceWith({ resumeId })
      expect(document.body.textContent).toContain(t.state.QUEUED)
      expect(io.confirm).not.toHaveBeenCalled()
    })

    it('loads private READY as plain text with all populated groups unselected', async () => {
      const t = messages(locale).resumeParse
      await mount(locale); await click(button(t.loadDraft))
      expect(document.body.textContent).toContain(t.reviewTitle)
      expect(document.body.textContent).toContain(current.headline)
      expect(document.body.textContent).toContain('Suggested headline')
      expect(document.querySelector('img')).toBeNull()
      for (const name of groups) expect(group(name).querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
      expect(button(t.confirm).disabled).toBe(true)
      expect(io.confirm).not.toHaveBeenCalled(); expect(io.request).not.toHaveBeenCalled()
    })

    it('saves only the selected edited group with source generation and profile revision', async () => {
      const t = messages(locale).resumeParse
      await mount(locale); await click(button(t.loadDraft))
      await input(group('headline').querySelector('textarea')!, 'Edited 学生标题')
      await selectGroup('headline'); await click(button(t.confirm))
      expect(io.confirm).toHaveBeenCalledExactlyOnceWith({ resumeId, generation: 2, expectedProfileRevision: 7, patch: { headline: 'Edited 学生标题' } })
      expect(document.querySelector('[data-testid="resume-parse-review"]')).toBeNull()
      expect(document.body.textContent).toContain(t.saved)
      expect(io.refresh).toHaveBeenCalledOnce()
    })

    it('explicitly clears selected scalar/list groups and leaves every unselected group absent', async () => {
      const t = messages(locale).resumeParse
      await mount(locale); await click(button(t.loadDraft))
      await input(group('summary').querySelector('textarea')!, '')
      await input(group('skills').querySelector('textarea')!, '\n  \n')
      await selectGroup('summary'); await selectGroup('skills'); await click(button(t.confirm))
      expect(io.confirm.mock.calls[0][0].patch).toEqual({ summary: null, skills: [] })
    })

    it('retains edits on revision conflict then requires a new selection after comparison', async () => {
      const t = messages(locale).resumeParse
      io.confirm.mockResolvedValueOnce({ ok: false, code: 'CONFLICT' })
      await mount(locale); await click(button(t.loadDraft))
      await input(group('headline').querySelector('textarea')!, 'Keep my edit')
      await selectGroup('headline'); await click(button(t.confirm))
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(t.error.conflict)
      expect(group('headline').querySelector('textarea')!.value).toBe('Keep my edit')
      expect(button(t.confirm).disabled).toBe(true)
      io.read.mockResolvedValue({ ok: true, data: ready({ profileRevision: 8, currentProfile: { ...current, headline: 'Later manual edit' } }) })
      await click(button(t.compareAgain))
      expect(group('headline').textContent).toContain('Later manual edit')
      expect(group('headline').querySelector('textarea')!.value).toBe('Keep my edit')
      expect(button(t.confirm).disabled).toBe(true)
      await selectGroup('headline'); await click(button(t.confirm))
      expect(io.confirm.mock.calls[1][0]).toMatchObject({ expectedProfileRevision: 8, patch: { headline: 'Keep my edit' } })
    })

    it('keeps edits and blocks confirmation when the draft generation changes during comparison', async () => {
      const t = messages(locale).resumeParse
      await mount(locale); await click(button(t.loadDraft))
      await input(group('headline').querySelector('textarea')!, 'Local generation edit'); await selectGroup('headline')
      io.read.mockResolvedValue({ ok: true, data: ready({ generation: 3 }) })
      await click(button(t.compareAgain))
      expect(group('headline').querySelector('textarea')!.value).toBe('Local generation edit')
      expect(button(t.confirm).disabled).toBe(true)
      expect(io.confirm).not.toHaveBeenCalled()
    })

    it('keeps manual editing and withdrawal usable while AI is disabled without a legal version', async () => {
      const t = messages(locale).resumeParse
      await mount(locale, { uiState: { available: false, consentGranted: true, legalVersion: null } })
      expect(button(t.request).disabled).toBe(true)
      expect(document.querySelector('a[href="/' + locale + '/s/profile"]')?.textContent).toBe(t.manualEdit)
      await click(button(t.loadDraft)); await selectGroup('headline')
      expect(button(t.confirm).disabled).toBe(true)
      await click(button(t.withdraw))
      expect(io.consent).toHaveBeenCalledExactlyOnceWith({ granted: false, submittedVersion: null })
      expect(document.querySelector('[data-testid="resume-parse-review"]')).toBeNull()
      expect(io.request).not.toHaveBeenCalled(); expect(io.confirm).not.toHaveBeenCalled()
    })

    it('discards only after explicit confirmation and retries the returned cancelled generation', async () => {
      const t = messages(locale).resumeParse
      await mount(locale); await click(button(t.loadDraft))
      await click(button(t.discard)); expect(io.discard).not.toHaveBeenCalled()
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(t.discardConfirm)
      await click(button(t.cancel, document.querySelector('[role="dialog"]')!))
      expect(io.discard).not.toHaveBeenCalled()
      io.read.mockResolvedValue({ ok: true, data: ready({ generation: 3, state: 'CANCELLED', payload: null, currentProfile: null }) })
      await click(button(t.discard))
      await click(button(t.discard, document.querySelector('[role="dialog"]')!))
      expect(io.discard).toHaveBeenCalledExactlyOnceWith({ resumeId, generation: 2 })
      expect(document.querySelector('[data-testid="resume-parse-review"]')).toBeNull()
      await click(button(t.retry))
      expect(io.request).toHaveBeenCalledExactlyOnceWith({ resumeId, expectedGeneration: 3 })
    })

    it('retains entered data and asks for new explicit consent after a legal version mismatch', async () => {
      const t = messages(locale).resumeParse
      io.confirm.mockResolvedValueOnce({ ok: false, code: 'VERSION_MISMATCH' })
      await mount(locale); await click(button(t.loadDraft))
      await input(group('headline').querySelector('textarea')!, 'Keep across policy change'); await selectGroup('headline')
      await click(button(t.confirm))
      expect(group('headline').querySelector('textarea')!.value).toBe('Keep across policy change')
      expect(button(t.confirm).disabled).toBe(true)
      expect(button(t.saveConsent).disabled).toBe(true)
      expect(button(t.withdraw).disabled).toBe(false)
      expect(io.refresh).toHaveBeenCalledOnce()
    })
  })
}

describe('resume review transport and editing boundaries', () => {
  it('lets the student explicitly select the first file after an ordinary upload refresh', async () => {
    const t = messages('en').resumeParse
    await mount('en', { resumes: [] })
    await rerender('en')
    const source = document.querySelector<HTMLSelectElement>('select')!
    expect(source.value).toBe('')
    expect(button(t.request).disabled).toBe(true)
    await act(async () => { source.value = resumeId; source.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(button(t.request).disabled).toBe(false)
    expect(io.request).not.toHaveBeenCalled(); expect(io.read).not.toHaveBeenCalled()
  })

  it('does not offer confirmation for a source removed by a refreshed file list', async () => {
    const t = messages('en').resumeParse
    await mount('en'); await click(button(t.loadDraft)); await selectGroup('headline')
    await rerender('en', { resumes: [{ ...props.resumes[0], id: secondResumeId }] })
    expect(document.querySelector('[data-testid="resume-parse-review"]')).toBeNull()
    expect(document.querySelector<HTMLSelectElement>('select')!.value).toBe('')
    expect(button(t.request).disabled).toBe(true)
    expect(io.confirm).not.toHaveBeenCalled()
  })

  it.each(['QUEUED', 'PROCESSING', 'FAILED', 'CANCELLED', 'CONFIRMED'] as const)('renders %s without a save form or automatic action', async state => {
    io.read.mockResolvedValue({ ok: true, data: ready({ state, payload: null, currentProfile: null, failureCode: state === 'FAILED' ? 'PDF_NO_TEXT' : null }) })
    await mount('en'); await click(button(messages('en').resumeParse.loadDraft))
    expect(document.body.textContent).toContain(messages('en').resumeParse.state[state])
    expect(document.querySelector('[data-testid="resume-parse-review"]')).toBeNull()
    expect(io.confirm).not.toHaveBeenCalled(); expect(io.request).not.toHaveBeenCalled()
  })

  it('guards two clicks while confirmation is pending and keeps its edited value on failure', async () => {
    const t = messages('en').resumeParse
    let resolve!: (result: unknown) => void
    io.confirm.mockReturnValue(new Promise(done => { resolve = done }))
    await mount('en'); await click(button(t.loadDraft)); await selectGroup('headline')
    await act(async () => { button(t.confirm).click(); button(t.confirm).click() })
    expect(io.confirm).toHaveBeenCalledOnce(); expect(button(t.confirm).disabled).toBe(true)
    await act(async () => resolve({ ok: false, code: 'FORBIDDEN', message: 'PRIVATE_PROVIDER_ERROR' }))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(t.error.forbidden)
    expect(document.body.textContent).not.toContain('PRIVATE_PROVIDER_ERROR')
    expect(group('headline').querySelector('textarea')!.value).toBe('Suggested headline')
  })

  it('edits an education entry, validates reversed dates and sends the selected whole group only', async () => {
    const t = messages('en').resumeParse
    await mount('en'); await click(button(t.loadDraft)); await selectGroup('educations')
    const dates = group('educations').querySelectorAll<HTMLInputElement>('input[type="date"]')
    await input(dates[0], '2025-01-01'); await input(dates[1], '2024-01-01'); await click(button(t.confirm))
    expect(io.confirm).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(t.error.invalid)
    await input(dates[1], '2026-01-01'); await click(button(t.confirm))
    expect(Object.keys(io.confirm.mock.calls[0][0].patch)).toEqual(['educations'])
    expect(io.confirm.mock.calls[0][0].patch.educations[0]).toMatchObject({ startDate: '2025-01-01T00:00:00.000Z', endDate: '2026-01-01T00:00:00.000Z' })
  })

  it('does not replace unsaved inputs when the student cancels a source change', async () => {
    await mount('en', { resumes: [...props.resumes, { ...props.resumes[0], id: secondResumeId }] })
    await click(button(messages('en').resumeParse.loadDraft)); await input(group('headline').querySelector('textarea')!, 'Retained')
    const source = document.querySelector<HTMLSelectElement>('select')!
    await act(async () => { source.value = secondResumeId; source.dispatchEvent(new Event('change', { bubbles: true })) })
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog?.textContent).toContain(messages('en').resumeParse.replaceLocal)
    await click(button(messages('en').resumeParse.cancel, dialog))
    expect(source.value).toBe(resumeId)
    expect(group('headline').querySelector('textarea')!.value).toBe('Retained')
  })

  it('reloads edited suggestions only after confirming in the accessible dialog', async () => {
    const t = messages('en').resumeParse
    await mount('en'); await click(button(t.loadDraft))
    await input(group('headline').querySelector('textarea')!, 'Retained until confirmed')
    await click(button(t.loadDraft))
    expect(io.read).toHaveBeenCalledTimes(1)
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog?.getAttribute('aria-describedby')).toBeTruthy()
    await click(button(t.replaceLocalContinue, dialog))
    expect(io.read).toHaveBeenCalledTimes(2)
    expect(group('headline').querySelector('textarea')!.value).toBe('Suggested headline')
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('allows multiline Chinese input without implicit confirmation', async () => {
    await mount('zh'); await click(button(messages('zh').resumeParse.loadDraft))
    const area = group('summary').querySelector('textarea')!
    await input(area, '第一行\n第二行')
    await act(async () => area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })))
    expect(area.value).toBe('第一行\n第二行'); expect(io.confirm).not.toHaveBeenCalled()
  })
})
