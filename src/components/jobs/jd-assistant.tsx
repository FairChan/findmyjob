'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { generateJobDescriptionAction } from '@/server/actions/jd-assistant'
import { generateJobDescriptionSchema } from '@/server/schemas/jd-assistant'
import { combineJdDescription, jdErrorMessage, readJdSuggestion, type JdAssistantErrorKey } from './jd-assistant-state'

export interface JdAssistantProps {
  title: string
  currentDescription: string
  descriptionRevision: number
  contextKey: string
  submittedVersion: string
  disabled: boolean
  onApply: (nextDescription: string, expectedRevision: number) => boolean
  onAppliedFocus: () => void
}

export function JdAssistant(props: JdAssistantProps) {
  // A changed authorization/editor context unmounts the session and invalidates its promises.
  return <JdAssistantSession key={JSON.stringify([props.contextKey, props.submittedVersion, props.title, props.disabled])} {...props} />
}

function JdAssistantSession({
  title, currentDescription, descriptionRevision, submittedVersion, disabled, onApply, onAppliedFocus,
}: JdAssistantProps) {
  const t = useTranslations('jdAssistant')
  const locale = useLocale()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [points, setPoints] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [zh, setZh] = useState('')
  const [en, setEn] = useState('')
  const [hasSuggestion, setHasSuggestion] = useState(false)
  const [sourceRevision, setSourceRevision] = useState<number | null>(null)
  const [confirmation, setConfirmation] = useState<{ text: string; revision: number } | null>(null)
  const [error, setError] = useState<JdAssistantErrorKey | null>(null)
  const [applied, setApplied] = useState(false)
  const appliedClose = useRef(false)
  const alive = useRef(true)
  const sequence = useRef(0)
  const activeRequest = useRef<number | null>(null)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; activeRequest.current = null }
  }, [])

  function changeOpen(next: boolean) {
    activeRequest.current = null
    setPending(false)
    setAcknowledged(false)
    setConfirmation(null)
    setError(null)
    if (next) { appliedClose.current = false; setApplied(false) }
    setOpen(next)
  }

  async function generate() {
    if (disabled || activeRequest.current !== null) return
    const parsed = generateJobDescriptionSchema.safeParse({ title, points, acknowledged, submittedVersion })
    if (!parsed.success) { setError('errorInput'); return }
    const request = ++sequence.current
    activeRequest.current = request
    setPending(true)
    setAcknowledged(false)
    setError(null)
    const revisionAtRequest = descriptionRevision
    try {
      const result = await generateJobDescriptionAction(parsed.data)
      if (!alive.current || activeRequest.current !== request) return
      if (!result.ok) { setError(jdErrorMessage(result.code)); return }
      const suggestion = readJdSuggestion(result.data)
      if (!suggestion) { setError('errorOutput'); return }
      setZh(suggestion.zh)
      setEn(suggestion.en)
      setHasSuggestion(true)
      setSourceRevision(revisionAtRequest)
    } catch {
      if (alive.current && activeRequest.current === request) setError('errorGeneric')
    } finally {
      if (alive.current && activeRequest.current === request) {
        activeRequest.current = null
        setPending(false)
      }
    }
  }

  function apply(confirming = false) {
    if (disabled || pending || activeRequest.current !== null) return
    const combined = combineJdDescription({ zh, en }, { zh: t('zhHeading'), en: t('enHeading') })
    if (!combined.ok) { setError(combined.error); return }
    if (!confirming && currentDescription.trim()) {
      setConfirmation({ text: currentDescription, revision: descriptionRevision })
      setError(null)
      return
    }
    const expectedRevision = confirming ? confirmation?.revision : descriptionRevision
    if (expectedRevision === undefined || !onApply(combined.text, expectedRevision)) {
      setConfirmation({ text: currentDescription, revision: descriptionRevision })
      setError('confirmationChanged')
      return
    }
    appliedClose.current = true
    setApplied(true)
    changeOpen(false)
  }

  const fieldClass = 'w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

  return (
    <div className="mt-3 space-y-2">
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" disabled={disabled} className="min-h-11 max-w-full whitespace-normal text-left">
            {t('trigger')}
          </Button>
        </DialogTrigger>
        <DialogContent
          data-testid="jd-assistant-dialog"
          closeLabel={t('close')}
          className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto motion-reduce:animate-none [&>button:last-child]:min-h-11 [&>button:last-child]:min-w-11"
          onCloseAutoFocus={event => {
            if (appliedClose.current) { event.preventDefault(); onAppliedFocus() }
          }}
        >
          <DialogHeader className="pr-10 text-left">
            <DialogTitle>{confirmation ? t('replaceTitle') : t('title')}</DialogTitle>
            <DialogDescription>{confirmation ? t('replaceDescription') : t('description')}</DialogDescription>
          </DialogHeader>
          {confirmation ? (
            <div className="min-w-0 space-y-3">
              <p id={id + '-current'} className="text-sm font-medium">{t('currentDescription')}</p>
              <pre data-testid="jd-replace-current" aria-labelledby={id + '-current'} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-3 font-sans text-base">{confirmation.text}</pre>
              {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" className="min-h-11 whitespace-normal" onClick={() => { setConfirmation(null); setError(null) }}>{t('keepEditing')}</Button>
                <Button type="button" className="min-h-11 whitespace-normal" onClick={() => apply(true)}>{t('replace')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="min-w-0 space-y-5" aria-busy={pending}>
              <div className="space-y-2">
                <label htmlFor={id + '-points'} className="block text-sm font-medium">{t('points')}</label>
                <textarea id={id + '-points'} name="points" value={points} onChange={event => setPoints(event.target.value)} maxLength={3000} rows={5} disabled={pending} aria-describedby={id + '-points-hint'} className={fieldClass} />
                <p id={id + '-points-hint'} className="text-sm text-muted-foreground">{t('pointsHint')}</p>
              </div>
              <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                <p id={id + '-disclosure'} className="text-sm">{t('disclosure')}</p>
                <a href={'/' + locale + '/legal/privacy'} className="inline-flex min-h-11 items-center text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('policy')}</a>
                <label htmlFor={id + '-acknowledged'} className="flex min-h-11 items-start gap-3 py-2 text-sm">
                  <input id={id + '-acknowledged'} name="acknowledged" type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={pending} aria-describedby={id + '-disclosure'} className="mt-0.5 h-6 w-6 shrink-0 accent-brand focus-visible:ring-2 focus-visible:ring-ring" />
                  {t('acknowledged')}
                </label>
              </div>
              <Button type="button" disabled={pending || disabled} onClick={() => void generate()} className="min-h-11 whitespace-normal">{pending ? t('generating') : t('generate')}</Button>
              {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{t(error)}</p>}
              {hasSuggestion && (
                <section className="space-y-3 border-t pt-4" aria-label={t('generated')}>
                  <p role="status" className="text-sm font-medium">{t('generated')}</p>
                  {sourceRevision !== descriptionRevision && <p className="text-sm text-muted-foreground">{t('editorChanged')}</p>}
                  <div className="grid min-w-0 gap-4 md:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                      <label htmlFor={id + '-zh'} className="block text-sm font-medium">{t('zhLabel')}</label>
                      <textarea id={id + '-zh'} name="zh" lang="zh" value={zh} onChange={event => setZh(event.target.value)} maxLength={4000} rows={9} disabled={pending} aria-describedby={id + '-length'} className={fieldClass} />
                    </div>
                    <div className="min-w-0 space-y-2">
                      <label htmlFor={id + '-en'} className="block text-sm font-medium">{t('enLabel')}</label>
                      <textarea id={id + '-en'} name="en" lang="en" value={en} onChange={event => setEn(event.target.value)} maxLength={4000} rows={9} disabled={pending} aria-describedby={id + '-length'} className={fieldClass} />
                    </div>
                  </div>
                  <p id={id + '-length'} className="text-sm text-muted-foreground">{t('lengthHint')}</p>
                </section>
              )}
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" className="min-h-11" onClick={() => changeOpen(false)}>{t('cancel')}</Button>
                {hasSuggestion && <Button type="button" disabled={pending} className="min-h-11 whitespace-normal" onClick={() => apply()}>{t('apply')}</Button>}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {applied && <p data-testid="jd-assistant-feedback" role="status" className="text-sm">{t('applied')}</p>}
    </div>
  )
}
