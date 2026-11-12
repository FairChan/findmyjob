'use client'

import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { resumePatchSchema, type ResumeSuggestionV1, type ResumeParsePatch } from '@/server/schemas/resume-parsing'
import type { ResumeParseDraftDto } from '@/server/services/resume-parsing'
import {
  setResumeParseConsentAction, requestResumeParseAction, getResumeParseDraftAction,
  confirmResumeParseAction, discardResumeParseDraftAction,
} from '@/server/actions/resume-parsing'
import { RESUME_GROUPS, ResumeGroupEditor, ResumeGroupValue, type ResumeGroup } from './resume-parse-fields'

export interface ResumeParsePanelProps {
  resumes: { id: string; fileName: string; createdAt: string }[]
  locale: string
  uiState: { available: boolean; consentGranted: boolean; legalVersion: string | null }
}

export function ResumeParsePanel({ resumes, locale, uiState }: ResumeParsePanelProps) {
  const t = useTranslations('resumeParse')
  const label = (key: string) => t(key as Parameters<typeof t>[0])
  const router = useRouter()
  const id = useId()
  const inFlight = useRef(false)
  const confirmationTrigger = useRef<HTMLElement | null>(null)
  const [confirmation, setConfirmation] = useState<{ kind: 'discard' | 'reload' } | { kind: 'source'; sourceId: string } | null>(null)
  const [sourceId, setSourceId] = useState(resumes[0]?.id ?? '')
  const [consentChecked, setConsentChecked] = useState(false)
  const [consented, setConsented] = useState(uiState.consentGranted)
  const [canWithdraw, setCanWithdraw] = useState(uiState.consentGranted)
  const [loadedDraft, setDraft] = useState<ResumeParseDraftDto | null>(null)
  const [edited, setEdited] = useState<ResumeSuggestionV1 | null>(null)
  const [selected, setSelected] = useState<Partial<Record<ResumeGroup, boolean>>>({})
  const [dirty, setDirty] = useState(false)
  const [stale, setStale] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const source = resumes.find(item => item.id === sourceId)
  const draft = source && loadedDraft?.resumeId === source.id ? loadedDraft : null
  const permitted = uiState.available && consented
  const buttonClass = 'h-auto min-h-11 whitespace-normal'

  function fail(code: string) {
    if (code === 'CONFLICT') setStale(true)
    if (code === 'VERSION_MISMATCH') { setConsented(false); setConsentChecked(false); router.refresh() }
    const key = code === 'CONFLICT' ? 'conflict' : code === 'VERSION_MISMATCH' ? 'version'
      : code === 'FEATURE_DISABLED' ? 'unavailable' : code === 'FORBIDDEN' ? 'forbidden'
        : code === 'NOT_FOUND' ? 'missing' : code === 'VALIDATION_ERROR' ? 'invalid'
          : code === 'RATE_LIMITED' ? 'rateLimited' : 'generic'
    setError(label('error.' + key))
  }
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true; setPending(true); setError(''); setNotice('')
    try { await work() } catch { fail('UNKNOWN') }
    finally { inFlight.current = false; setPending(false) }
  }
  function clearReview() {
    setDraft(null); setEdited(null); setSelected({}); setDirty(false); setStale(false)
  }
  async function readDraft(preserve: boolean) {
    if (!source) return
    const result = await getResumeParseDraftAction({ resumeId: source.id })
    if (!result.ok) { fail(result.code); return }
    const next = result.data
    if (preserve && (!next || next.state !== 'READY' || next.generation !== draft?.generation)) {
      fail('CONFLICT'); return
    }
    setDraft(next); setSelected({}); setStale(false)
    if (!preserve) { setEdited(next?.state === 'READY' ? next.payload : null); setDirty(false) }
    setNotice(label(preserve ? 'compared' : next ? 'loaded' : 'noDraft'))
  }
  function load(preserve: boolean) {
    if (!preserve && dirty) { ask({ kind: 'reload' }); return }
    void run(() => readDraft(preserve))
  }
  function ask(next: NonNullable<typeof confirmation>) {
    confirmationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirmation(next)
  }
  function changeSource(nextId: string) {
    if (!resumes.some(item => item.id === nextId)) return
    setSourceId(nextId); clearReview(); setError(''); setNotice('')
  }
  function acceptConfirmation() {
    const next = confirmation
    setConfirmation(null)
    if (next?.kind === 'discard') discard()
    else if (next?.kind === 'reload') void run(() => readDraft(false))
    else if (next?.kind === 'source') changeSource(next.sourceId)
  }
  function consent(granted: boolean) {
    if (granted && (!uiState.available || !uiState.legalVersion || !consentChecked)) return
    void run(async () => {
      const result = await setResumeParseConsentAction(granted
        ? { granted: true, submittedVersion: uiState.legalVersion! }
        : { granted: false, submittedVersion: uiState.legalVersion })
      if (!result.ok) { fail(result.code); return }
      setConsented(granted); setCanWithdraw(granted); setConsentChecked(false)
      if (!granted) clearReview()
      setNotice(label(granted ? 'consentSaved' : 'consentWithdrawn'))
    })
  }
  function request() {
    if (!source || !permitted) return
    void run(async () => {
      // Discover a cancelled generation after revoke/remount before retrying it.
      let current = draft
      if (!current) {
        const loaded = await getResumeParseDraftAction({ resumeId: source.id })
        if (!loaded.ok) { fail(loaded.code); return }
        current = loaded.data
        if (current && current.state !== 'FAILED' && current.state !== 'CANCELLED') {
          setDraft(current); setEdited(current.state === 'READY' ? current.payload : null)
          setSelected({}); setDirty(false); setStale(false); setNotice(t('loaded')); return
        }
      }
      const result = await requestResumeParseAction({ resumeId: source.id,
        ...(current ? { expectedGeneration: current.generation } : {}) })
      if (!result.ok) { fail(result.code); return }
      await readDraft(false)
    })
  }
  function discard() {
    if (!draft) return
    void run(async () => {
      const result = await discardResumeParseDraftAction({ resumeId: draft.resumeId, generation: draft.generation })
      if (!result.ok) { fail(result.code); return }
      clearReview(); await readDraft(false); setNotice(t('discarded'))
    })
  }
  function confirmDraft() {
    if (!draft || draft.state !== 'READY' || !edited || !permitted || stale) return
    const patch: ResumeParsePatch = {}
    for (const group of RESUME_GROUPS) if (selected[group]) Object.assign(patch, {
      [group]: group === 'skills' ? edited.skills.map(skill => skill.trim()).filter(Boolean) : edited[group],
    })
    const parsed = resumePatchSchema.safeParse(patch)
    if (!parsed.success) { fail('VALIDATION_ERROR'); return }
    void run(async () => {
      const result = await confirmResumeParseAction({ resumeId: draft.resumeId, generation: draft.generation,
        expectedProfileRevision: draft.profileRevision, patch: parsed.data })
      if (!result.ok) { fail(result.code); return }
      clearReview(); setNotice(t('saved')); router.refresh()
    })
  }
  function date(value: string | null) {
    if (!value || !Number.isFinite(Date.parse(value))) return t('notProvided')
    return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-Hans-MY' : 'en-MY', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur',
    }).format(new Date(value))
  }
  const ready = draft?.state === 'READY' && draft.payload && draft.currentProfile && edited
  const requestable = !draft || draft.state === 'FAILED' || draft.state === 'CANCELLED'

  return <section data-testid="resume-parse-panel" aria-labelledby={id + '-title'} className="mt-8 min-w-0 space-y-5 rounded-card bg-muted p-5 sm:p-6">
    <h2 id={id + '-title'} className="text-title">{t('title')}</h2>
    <p className="text-sm text-muted-foreground">{t('description')}</p>
    <a href={'/' + locale + '/s/profile'} className="inline-flex min-h-11 items-center text-sm text-brand underline underline-offset-4">{t('manualEdit')}</a>
    {!uiState.available && <p role="status" className="rounded-control bg-background p-3 text-sm">{t('unavailable')}</p>}
    <div className="space-y-3 rounded-control bg-background p-4">
      <p className="text-sm">{t('disclosure')}</p>
      <a href={'/' + locale + '/legal/privacy'} className="inline-flex min-h-11 items-center text-sm text-brand underline underline-offset-4">{t('privacyPolicy')}</a>
      {canWithdraw && <div className="space-y-2"><p className="text-sm">{t('consentActive')}</p>
        <Button type="button" variant="outline" disabled={pending} onClick={() => consent(false)} className={buttonClass}>{t('withdraw')}</Button></div>}
      {!consented && <div className="space-y-3">
        <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={consentChecked}
          disabled={pending || !uiState.available || !uiState.legalVersion} onChange={event => setConsentChecked(event.target.checked)} className="mt-1 size-4 shrink-0" />
          <span>{t('consentLabel')}</span></label>
        <Button type="button" disabled={pending || !consentChecked || !uiState.available || !uiState.legalVersion}
          onClick={() => consent(true)} className={buttonClass}>{t('saveConsent')}</Button>
      </div>}
    </div>
    {!resumes.length ? <p className="text-sm text-muted-foreground">{t('uploadFirst')}</p> : <>
      <label className="block space-y-2 text-sm"><span>{t('sourceFile')}</span><select value={source ? sourceId : ''} disabled={pending}
        onChange={event => {
          if (dirty) ask({ kind: 'source', sourceId: event.target.value })
          else changeSource(event.target.value)
        }} className="w-full min-w-0 rounded-control border border-input bg-background p-3 text-base">
        {!source && <option value="" disabled>{t('chooseSource')}</option>}
        {resumes.map(resume => <option key={resume.id} value={resume.id}>{resume.fileName}</option>)}
      </select></label>
      {source && <p className="break-words text-sm text-muted-foreground">{t('sourceUploaded', { date: date(source.createdAt) })}</p>}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled={pending || !source} onClick={() => load(false)} className={buttonClass}>{t('loadDraft')}</Button>
        <Button type="button" disabled={pending || !source || !permitted || !requestable} onClick={request} className={buttonClass}>{t(draft ? 'retry' : 'request')}</Button>
      </div>
    </>}
    {draft && <div className="space-y-2 rounded-control bg-background p-4 text-sm">
      <p role="status">{label('state.' + draft.state)}</p>
      <p className="break-words [overflow-wrap:anywhere]">{t('sourceFile')}: {draft.source.fileName}</p>
      <p>{t('sourceUploaded', { date: date(draft.source.createdAt) })}</p>
      <p>{t('requestedAt', { date: date(draft.requestedAt) })}</p>
      <p>{t('completedAt', { date: date(draft.completedAt) })}</p>
      {draft.state === 'FAILED' && <p>{t(draft.failureCode === 'PDF_NO_TEXT' ? 'noText' : 'failed')}</p>}
      <Button type="button" variant="outline" disabled={pending} onClick={() => ask({ kind: 'discard' })} className={buttonClass}>{t('discard')}</Button>
    </div>}
    {ready && <div className="space-y-5" data-testid="resume-parse-review">
      <h3 className="text-lg font-semibold">{t('reviewTitle')}</h3>
      <p className="text-sm text-muted-foreground">{t('selectionHint')}</p>
      <Button type="button" variant="outline" disabled={pending} onClick={() => load(true)} className={buttonClass}>{t('compareAgain')}</Button>
      {RESUME_GROUPS.map(group => <fieldset key={group} data-testid={'parse-group-' + group} disabled={pending}
        className="min-w-0 space-y-4 rounded-control bg-background p-4">
        <legend className="px-1 font-semibold">{label('group.' + group)}</legend>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <section aria-label={t('currentValue')} className="min-w-0 space-y-2"><h4 className="text-sm font-medium">{t('currentValue')}</h4><ResumeGroupValue group={group} value={draft.currentProfile!} /></section>
          <section aria-label={t('suggestedValue')} className="min-w-0 space-y-2"><h4 className="text-sm font-medium">{t('suggestedValue')}</h4><ResumeGroupValue group={group} value={draft.payload!} /></section>
        </div>
        <ResumeGroupEditor group={group} value={edited!} onChange={value => { setEdited(value); setDirty(true) }} />
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={!!selected[group]}
          onChange={event => { setSelected(current => ({ ...current, [group]: event.target.checked })); setDirty(true) }} className="size-4" />
          {t('selectGroup', { group: label('group.' + group) })}</label>
      </fieldset>)}
      <Button type="button" disabled={pending || !permitted || stale || !Object.values(selected).some(Boolean)}
        aria-busy={pending} onClick={confirmDraft} className={buttonClass}>{t('confirm')}</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p role="status" aria-live="polite" className="text-sm">{pending ? t('pending') : notice}</p>
    <Dialog open={confirmation !== null} onOpenChange={open => { if (!open) setConfirmation(null) }}>
      <DialogContent closeLabel={t('close')} className="max-w-[calc(100%-2rem)] sm:max-w-lg [&>button:last-child]:min-h-6 [&>button:last-child]:min-w-6"
        onCloseAutoFocus={event => { event.preventDefault(); confirmationTrigger.current?.focus() }}>
        <DialogHeader>
          <DialogTitle>{t(confirmation?.kind === 'discard' ? 'discard' : 'replaceLocalTitle')}</DialogTitle>
          <DialogDescription>{t(confirmation?.kind === 'discard' ? 'discardConfirm' : 'replaceLocal')}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-3">
          <Button type="button" variant="outline" onClick={() => setConfirmation(null)} className={buttonClass}>{t('cancel')}</Button>
          <Button type="button" onClick={acceptConfirmation} className={buttonClass}>{t(confirmation?.kind === 'discard' ? 'discard' : 'replaceLocalContinue')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}
