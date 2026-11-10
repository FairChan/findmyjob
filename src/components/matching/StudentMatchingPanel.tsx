'use client'
import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { recommendJobsAction, setMatchingConsentAction } from '@/server/actions/semantic-matching'
import type { StudentMatchingUiState } from '@/server/services/semantic-matching'
import type { JobListItem } from '@/server/serializers/job'
import { MatchingJobCards } from './MatchingCards'
import { matchingErrorKey } from './matching-ui'

export interface StudentMatchingPanelProps { locale: string; uiState: StudentMatchingUiState; consentOnly?: boolean }
export function StudentMatchingPanel({ locale, uiState, consentOnly = false }: StudentMatchingPanelProps) {
  const t = useTranslations('matching'), router = useRouter(), id = useId()
  const metadataKey = JSON.stringify([uiState.consentGranted, uiState.consentCurrent, uiState.legalVersion])
  const [localConsent, setLocalConsent] = useState<{ key: string; granted: boolean; version: string | null } | null>(null)
  const effective = localConsent?.key === metadataKey ? localConsent : {
    granted: uiState.consentGranted, version: uiState.consentCurrent ? uiState.legalVersion : null,
  }
  const current = effective.version !== null && effective.version === uiState.legalVersion
  const permitted = uiState.available && current
  const [checkedVersion, setCheckedVersion] = useState<string | null>(null)
  const checked = !!uiState.legalVersion && checkedVersion === uiState.legalVersion
  const [consentPending, setConsentPending] = useState(false), [requestPending, setRequestPending] = useState(false)
  const [items, setItems] = useState<JobListItem[]>([])
  const [notice, setNotice] = useState(''), [error, setError] = useState('')
  const consentFlight = useRef(false), requestFlight = useRef(false), epoch = useRef(0)
  const permission = useRef({ metadataKey, permitted })
  useEffect(() => {
    permission.current = { metadataKey, permitted }
    return () => { permission.current = { metadataKey: '', permitted: false } }
  }, [metadataKey, permitted])
  const buttonClass = 'h-auto min-h-11 whitespace-normal'
  const linkClass = 'inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4'

  function failure(code: string) {
    setError(t(matchingErrorKey(code)))
    if (code === 'VERSION_MISMATCH' || code === 'FORBIDDEN') {
      epoch.current++; setItems([]); setCheckedVersion(null)
      setLocalConsent({ key: metadataKey, granted: effective.granted, version: null }); router.refresh()
    }
  }
  async function consent(granted: boolean) {
    if (consentFlight.current || granted && (!uiState.available || !uiState.legalVersion || !checked)) return
    consentFlight.current = true; epoch.current++; setItems([]); setError(''); setNotice(''); setConsentPending(true)
    if (!granted) setLocalConsent({ key: metadataKey, granted: effective.granted, version: null })
    try {
      const result = await setMatchingConsentAction(granted
        ? { granted: true, submittedVersion: uiState.legalVersion! }
        : { granted: false, submittedVersion: uiState.legalVersion })
      if (!result.ok) { failure(result.code); return }
      setLocalConsent({ key: metadataKey, granted, version: granted ? uiState.legalVersion : null })
      setCheckedVersion(null); setNotice(t(granted ? 'consentSaved' : 'consentWithdrawn'))
    } catch { failure('UNKNOWN') }
    finally { consentFlight.current = false; setConsentPending(false) }
  }
  async function request() {
    if (requestFlight.current || consentPending || !permitted || consentOnly) return
    requestFlight.current = true; setRequestPending(true); setItems([]); setNotice(''); setError('')
    const token = ++epoch.current
    try {
      const result = await recommendJobsAction({ limit: 10 })
      if (epoch.current !== token || permission.current.metadataKey !== metadataKey || !permission.current.permitted) return
      if (!result.ok) { failure(result.code); return }
      if (result.data.availability === 'unavailable') { setNotice(t('unavailable')); return }
      setItems(result.data.items); setNotice(t(result.data.items.length ? 'loaded' : 'empty'))
    } catch { if (epoch.current === token) failure('UNKNOWN') }
    finally { requestFlight.current = false; setRequestPending(false) }
  }

  return <section data-testid={consentOnly ? 'matching-consent-panel' : 'student-matching-panel'} aria-labelledby={id + '-title'}
    className="my-8 min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6">
    <h2 id={id + '-title'} className="text-xl font-semibold">{t(consentOnly ? 'consentTitle' : 'studentTitle')}</h2>
    {!consentOnly && <p className="text-sm text-muted-foreground">{t('studentDescription')}</p>}
    <div className="space-y-3 rounded-lg border p-4">
      {!consentOnly && <h3 className="font-medium">{t('consentTitle')}</h3>}
      <p className="text-sm">{t('disclosure')}</p>
      <Link href={'/' + locale + '/legal/privacy'} prefetch={false} className={linkClass}>{t('privacyPolicy')}</Link>
      {effective.granted && <div className="space-y-2"><p className="text-sm">{t('consentActive')}</p>
        <Button type="button" variant="outline" disabled={consentPending} onClick={() => void consent(false)} className={buttonClass}>{t('withdraw')}</Button></div>}
      {!current && <div className="space-y-3">
        <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={checked}
          disabled={consentPending || !uiState.available || !uiState.legalVersion}
          onChange={event => setCheckedVersion(event.target.checked ? uiState.legalVersion : null)} className="mt-1 size-4 shrink-0" />
          <span>{t('consentLabel')}</span></label>
        <Button type="button" disabled={consentPending || !checked || !uiState.available} onClick={() => void consent(true)} className={buttonClass}>{t('saveConsent')}</Button>
      </div>}
    </div>
    {!uiState.available && <p role="status" className="rounded-md bg-muted p-3 text-sm">{t('unavailable')}</p>}
    {!consentOnly && <>
      {!current && <p className="text-sm text-muted-foreground">{t('needConsent')}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={requestPending || consentPending || !permitted} aria-busy={requestPending} onClick={() => void request()} className={buttonClass}>{t('requestJobs')}</Button>
        <Link href={'/' + locale + '/jobs'} prefetch={false} className={linkClass}>{t('searchJobs')}</Link>
        <Link href={'/' + locale + '/s/profile'} prefetch={false} className={linkClass}>{t('editProfile')}</Link>
        <Link href={'/' + locale + '/s/privacy'} prefetch={false} className={linkClass}>{t('manageConsent')}</Link>
      </div>
      {permitted && items.length > 0 && <div className="space-y-3"><h3 className="font-semibold">{t('results')}</h3><MatchingJobCards items={items} locale={locale} /></div>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p role="status" aria-live="polite" className="text-sm">{consentPending ? t('saving') : requestPending ? t('pending') : notice}</p>
  </section>
}
