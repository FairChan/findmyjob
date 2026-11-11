'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { bankTransferSettingsSchema, BANK_TRANSFER_LIMITS, type BankTransferSettings } from '@/server/lib/billing-settings'
import { saveBankTransferSettingsAction } from './actions'

export function BankTransferForm({ initialValue }: { initialValue: BankTransferSettings }) {
  const t = useTranslations('adminBankTransfer')
  const locale = useLocale()
  const id = useId()
  const inFlight = useRef(false)
  const [draft, setDraft] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(0)
  const fieldClass = 'w-full min-w-0 rounded-card border border-border bg-card px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-brand disabled:bg-muted'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    setSaved(0)
    const parsed = bankTransferSettingsSchema.safeParse(draft)
    if (!parsed.success) { setError('VALIDATION_ERROR'); return }
    inFlight.current = true
    setPending(true)
    try {
      const result = await saveBankTransferSettingsAction(parsed.data)
      if (result.ok) { setDraft(parsed.data); setSaved(Date.now()) }
      else setError(result.code)
    } catch { setError('UNKNOWN') }
    finally { inFlight.current = false; setPending(false) }
  }

  const authError = ['FORBIDDEN', 'FRESH_SESSION_REQUIRED', 'TWO_FACTOR_REQUIRED'].includes(error)
  return (
    <section className="mb-8 min-w-0 rounded-card border border-border bg-card p-4 sm:p-6" aria-labelledby={id + '-heading'}>
      <h2 id={id + '-heading'} className="text-lg font-semibold">{t('title')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('description')}</p>
      <form data-testid="bank-transfer-settings" noValidate onSubmit={submit} aria-busy={pending} className="mt-5 space-y-4">
        <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
          {(['bankName', 'accountName', 'accountNumber', 'instructions'] as const).map((key) => <div key={key} className={'min-w-0 space-y-2 ' + (key === 'instructions' ? 'sm:col-span-2' : '')}>
            <label htmlFor={id + '-' + key} className="block text-sm font-medium">{t(key)}</label>
            {key === 'instructions'
              ? <textarea id={id + '-' + key} name={key} rows={3} maxLength={BANK_TRANSFER_LIMITS[key]} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} aria-describedby={id + '-instructions-hint'} className={fieldClass} />
              : <input id={id + '-' + key} name={key} type="text" autoComplete="off" maxLength={BANK_TRANSFER_LIMITS[key]} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} aria-describedby={key === 'accountNumber' ? id + '-accountNumber-hint' : undefined} className={fieldClass} />}
            {key === 'accountNumber' && <p id={id + '-accountNumber-hint'} className="text-xs text-muted-foreground">{t('accountNumberHint')}</p>}
            {key === 'instructions' && <p id={id + '-instructions-hint'} className="text-xs text-muted-foreground">{t('instructionsHint')}</p>}
          </div>)}
        </fieldset>
        <p className="text-xs text-muted-foreground">{t('clearHint')}</p>
        {error && <p role="alert" className="text-sm text-destructive">{t(error === 'VALIDATION_ERROR' ? 'errorInvalid' : error === 'TWO_FACTOR_REQUIRED' ? 'errorTwoFactor' : authError ? 'errorForbidden' : 'errorGeneric')}</p>}
        {authError && <a href={'/' + locale + (error === 'TWO_FACTOR_REQUIRED' ? '/two-factor/setup' : '/login')} className="block text-sm text-brand underline">{t(error === 'TWO_FACTOR_REQUIRED' ? 'setupTwoFactor' : 'signIn')}</a>}
        <p role="status" aria-atomic="true" className="text-sm text-success"><span key={saved}>{saved ? t('bankSaved') : ''}</span></p>
        <Button type="submit" disabled={pending}>{t(pending ? 'saving' : 'saveBank')}</Button>
      </form>
    </section>
  )
}
