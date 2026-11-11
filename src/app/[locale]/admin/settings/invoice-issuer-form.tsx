'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { invoiceIssuerSettingsSchema, INVOICE_ISSUER_LIMITS, type InvoiceIssuerSettings } from '@/server/lib/invoice-settings'
import { saveInvoiceIssuerSettingsAction } from './actions'

export function InvoiceIssuerForm({ initialValue }: { initialValue: InvoiceIssuerSettings }) {
  const t = useTranslations('adminInvoiceIssuer')
  const locale = useLocale()
  const id = useId()
  const inFlight = useRef(false)
  const [draft, setDraft] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [invalidFields, setInvalidFields] = useState<string[]>([])
  const [saved, setSaved] = useState(0)
  const fieldClass = 'w-full min-w-0 rounded-card border border-border bg-card px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-brand disabled:bg-muted'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    setSaved(0)
    setInvalidFields([])
    const parsed = invoiceIssuerSettingsSchema.safeParse(draft)
    if (!parsed.success) {
      const fields = parsed.error.issues.flatMap(issue => typeof issue.path[0] === 'string' ? [issue.path[0]] : [])
      setInvalidFields(fields)
      setError('VALIDATION_ERROR')
      const field = event.currentTarget.elements.namedItem(fields[0] ?? '')
      if (field instanceof HTMLElement) field.focus()
      return
    }
    inFlight.current = true
    setPending(true)
    try {
      const result = await saveInvoiceIssuerSettingsAction(parsed.data)
      if (result.ok) { setDraft(parsed.data); setSaved(Date.now()) }
      else setError(result.code)
    } catch { setError('UNKNOWN') }
    finally { inFlight.current = false; setPending(false) }
  }

  function edit(field: keyof typeof INVOICE_ISSUER_LIMITS, value: string) {
    setDraft(current => ({ ...current, [field]: field === 'registrationNo' && value === '' ? null : value }))
    setSaved(0)
    setError('')
    setInvalidFields(current => current.filter(key => key !== field))
  }

  const authError = ['FORBIDDEN', 'FRESH_SESSION_REQUIRED', 'TWO_FACTOR_REQUIRED'].includes(error)
  return (
    <section className="mb-8 min-w-0 rounded-card border border-border bg-card p-4 sm:p-6" aria-labelledby={id + '-heading'}>
      <h2 id={id + '-heading'} className="text-lg font-semibold">{t('title')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('description')}</p>
      <form data-testid="invoice-issuer-settings" noValidate onSubmit={submit} aria-busy={pending} className="mt-5 space-y-4">
        <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
          {(['legalName', 'address', 'registrationNo', 'version'] as const).map(key => <div key={key} className={'min-w-0 space-y-2 ' + (key === 'legalName' || key === 'address' ? 'sm:col-span-2' : '')}>
            <label htmlFor={id + '-' + key} className="block text-sm font-medium">{t(key)}</label>
            {key === 'address'
              ? <textarea id={id + '-' + key} name={key} rows={4} value={draft[key]} onChange={event => edit(key, event.target.value)} aria-invalid={invalidFields.includes(key) || undefined} aria-describedby={id + '-' + key + '-hint'} className={fieldClass} />
              : <input id={id + '-' + key} name={key} type="text" autoComplete="off" value={draft[key] ?? ''} onChange={event => edit(key, event.target.value)} aria-invalid={invalidFields.includes(key) || undefined} aria-describedby={id + '-' + key + '-hint'} className={fieldClass} />}
            <p id={id + '-' + key + '-hint'} className="text-xs text-muted-foreground">{t('limitHint', { max: INVOICE_ISSUER_LIMITS[key] })}{key === 'version' ? ' ' + t('versionHint') : ''}</p>
          </div>)}
        </fieldset>
        <p className="text-xs text-muted-foreground">{t('clearHint')}</p>
        {error && <p role="alert" className="text-sm text-destructive">{t(error === 'VALIDATION_ERROR' ? 'errorInvalid' : error === 'TWO_FACTOR_REQUIRED' ? 'errorTwoFactor' : authError ? 'errorForbidden' : 'errorGeneric')}</p>}
        {authError && <a href={'/' + locale + (error === 'TWO_FACTOR_REQUIRED' ? '/two-factor/setup' : '/login')} className="block text-sm text-brand underline">{t(error === 'TWO_FACTOR_REQUIRED' ? 'setupTwoFactor' : 'signIn')}</a>}
        <p role="status" aria-atomic="true" className="text-sm text-success"><span key={saved}>{saved ? t('issuerSaved') : ''}</span></p>
        <Button type="submit" disabled={pending}>{t(pending ? 'saving' : 'saveIssuer')}</Button>
      </form>
    </section>
  )
}
