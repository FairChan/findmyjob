'use client'

import { Select } from '@/components/ui/select'
import { useId, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import { publicShowcaseSchema, SHOWCASE_LIMIT, type PublicShowcaseConfig } from '@/schemas/public-showcase'
import { savePublicShowcaseSettingsAction } from './actions'

type Option = { id: string; label: string }
const fieldClass = 'w-full min-w-0 rounded-control border border-input bg-card px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-brand'

export function ShowcaseForm({ initialValue, options }: {
  initialValue: PublicShowcaseConfig; options: { jobs: Option[]; companies: Option[] };
}) {
  const t = useTranslations('adminShowcase')
  const locale = useLocale()
  const id = useId()
  const [draft, setDraft] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const inFlight = useRef(false)

  function move(key: 'jobIds' | 'companyIds', index: number, offset: number) {
    setSaved(false)
    setDraft(current => {
      const ids = [...current[key]]
      const other = index + offset
      if (other < 0 || other >= ids.length) return current
      ;[ids[index], ids[other]] = [ids[other], ids[index]]
      return { ...current, [key]: ids }
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    setError(''); setSaved(false)
    const parsed = publicShowcaseSchema.safeParse(draft)
    if (!parsed.success) { setError('VALIDATION_ERROR'); return }
    inFlight.current = true; setPending(true)
    try {
      const result = await savePublicShowcaseSettingsAction(parsed.data)
      if (result.ok) { setDraft(parsed.data); setSaved(true) }
      else setError(result.code)
    } catch { setError('UNKNOWN') }
    finally { inFlight.current = false; setPending(false) }
  }
  const authError = ['FORBIDDEN', 'FRESH_SESSION_REQUIRED', 'TWO_FACTOR_REQUIRED'].includes(error)

  return <section className="min-w-0 rounded-card border border-border bg-card p-4 sm:p-6" aria-labelledby={id + '-heading'}>
    <h2 id={id + '-heading'} className="text-lg font-semibold">{t('title')}</h2>
    <p className="mt-2 text-sm text-muted-foreground">{t('description')}</p>
    <form noValidate onSubmit={submit} aria-busy={pending} data-testid="showcase-settings" className="mt-6 space-y-6">
      <fieldset disabled={pending} className="min-w-0 space-y-6">
        <legend className="sr-only">{t('title')}</legend>
        {(['jobs', 'companies'] as const).map(kind => {
          const key = kind === 'jobs' ? 'jobIds' : 'companyIds'
          const selected = draft[key]
          const available = options[kind].filter(option => !selected.includes(option.id))
          return <div key={kind} className="min-w-0 space-y-4 border-t border-border pt-5">
            <h3 className="font-semibold">{t(kind)}</h3>
            <label htmlFor={`${id}-${kind}`} className="block text-sm font-medium">{t('addSelection')}</label>
            <Select id={`${id}-${kind}`} value="" disabled={selected.length >= SHOWCASE_LIMIT} className={fieldClass} onChange={event => {
              const value = event.target.value
              if (!value) return
              setSaved(false)
              setDraft(current => ({ ...current, [key]: [...current[key], value] }))
            }} aria-describedby={`${id}-${kind}-hint`}>
              <option value="">{t(selected.length >= SHOWCASE_LIMIT ? 'limitReached' : 'choose')}</option>
              {available.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </Select>
            <p id={`${id}-${kind}-hint`} className="text-xs text-muted-foreground">{t('selectionHint')}</p>
            <ol className="space-y-2">{selected.map((selection, index) => {
              const option = options[kind].find(option => option.id === selection)
              const label = option?.label || t('unavailable')
              return <li key={selection} className="flex min-w-0 flex-wrap items-center gap-2 rounded-control bg-muted p-3">
                <span className="min-w-0 flex-1 basis-40 break-words text-sm">{index + 1}. {label}</span>
                <div className="flex gap-1">
                  <Button type="button" variant="outline" size="icon" disabled={index === 0} aria-label={t('moveUp', { name: label })} onClick={() => move(key, index, -1)}><ArrowUp aria-hidden="true" /></Button>
                  <Button type="button" variant="outline" size="icon" disabled={index === selected.length - 1} aria-label={t('moveDown', { name: label })} onClick={() => move(key, index, 1)}><ArrowDown aria-hidden="true" /></Button>
                  <Button type="button" variant="outline" size="icon" aria-label={t('remove', { name: label })} onClick={() => { setSaved(false); setDraft(current => ({ ...current, [key]: current[key].filter(value => value !== selection) })) }}><X aria-hidden="true" /></Button>
                </div>
              </li>
            })}</ol>
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">{(['zh', 'en'] as const).map(language => <div key={language} className="min-w-0 space-y-3">
              <h4 className="text-sm font-semibold">{t(language)}</h4>
              {(['title', 'description'] as const).map(field => <div key={field} className="space-y-2">
                <label className="block text-sm" htmlFor={`${id}-${kind}-${language}-${field}`}>{t(field === 'title' ? 'copyTitle' : 'copyDescription')}</label>
                <input id={`${id}-${kind}-${language}-${field}`} value={draft[kind][language][field]} maxLength={field === 'title' ? 80 : 240} className={fieldClass} onChange={event => {
                  const value = event.target.value
                  setSaved(false)
                  setDraft(current => ({ ...current, [kind]: { ...current[kind], [language]: { ...current[kind][language], [field]: value } } }))
                }} />
              </div>)}
            </div>)}</div>
          </div>
        })}
      </fieldset>
      <p className="text-xs text-muted-foreground">{t('copyHint')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{t(error === 'VALIDATION_ERROR' ? 'errorInvalid' : error === 'TWO_FACTOR_REQUIRED' ? 'errorTwoFactor' : authError ? 'errorForbidden' : 'errorGeneric')}</p>}
      {authError && <Link className="block text-sm text-brand underline" href={error === 'TWO_FACTOR_REQUIRED' ? '/two-factor/setup' : `/login?redirect=${encodeURIComponent(`/${locale}/admin/settings`)}`}>{t(error === 'TWO_FACTOR_REQUIRED' ? 'setupTwoFactor' : 'signIn')}</Link>}
      <p role="status" aria-atomic="true" className="text-sm text-success">{saved ? t('saved') : ''}</p>
      <Button type="submit" disabled={pending}>{t(pending ? 'saving' : 'save')}</Button>
    </form>
  </section>
}
