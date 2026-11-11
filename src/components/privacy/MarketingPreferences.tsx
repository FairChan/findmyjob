'use client'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { setMarketingConsentAction } from '@/server/actions/marketing-consent'
import type { MarketingUiState } from '@/server/services/marketing-consent'

const subscribeHydration = () => () => undefined
const clientReady = () => true
const serverReady = () => false
export interface MarketingPreferencesProps { locale: string; audience: 'student' | 'employer'; uiState: MarketingUiState }

export function MarketingPreferences({ locale, audience, uiState }: MarketingPreferencesProps) {
  const t = useTranslations('marketing'), router = useRouter(), id = useId()
  const hydrated = useSyncExternalStore(subscribeHydration, clientReady, serverReady)
  const metadataKey = JSON.stringify([uiState.available, uiState.consentGranted, uiState.legalVersion])
  const [localConsent, setLocalConsent] = useState<{ key: string; granted: boolean } | null>(null)
  const granted = localConsent?.key === metadataKey ? localConsent.granted : uiState.consentGranted
  const [checkedKey, setCheckedKey] = useState<string | null>(null)
  const canGrant = uiState.available && !!uiState.legalVersion
  const checked = canGrant && checkedKey === metadataKey
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState(''), [error, setError] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null)
  const flight = useRef(false), currentMetadata = useRef<string | null>(null)
  useEffect(() => {
    currentMetadata.current = metadataKey
    return () => { currentMetadata.current = null }
  }, [metadataKey])
  useEffect(() => {
    // Withdrawal removes its trigger; keep keyboard users at the resulting feedback.
    if (notice && !pending) statusRef.current?.focus({ preventScroll: true })
  }, [notice, pending])

  function failure(code: string) {
    const key = code === 'VERSION_MISMATCH' ? 'version' : code === 'FORBIDDEN' ? 'denied'
      : code === 'FEATURE_DISABLED' ? 'unavailable' : code === 'RATE_LIMITED' ? 'rateLimited' : 'generic'
    setError(t('error.' + key))
    if (code === 'VERSION_MISMATCH' || code === 'FEATURE_DISABLED' || code === 'FORBIDDEN') {
      setCheckedKey(null); router.refresh()
    }
  }
  async function save(nextGranted: boolean) {
    if (flight.current || !hydrated || nextGranted && (!canGrant || !checked)) return
    flight.current = true; setPending(true); setNotice(''); setError('')
    try {
      const result = await setMarketingConsentAction(nextGranted
        ? { granted: true, submittedVersion: uiState.legalVersion! }
        : { granted: false })
      if (currentMetadata.current === null) return
      if (currentMetadata.current !== metadataKey) { router.refresh(); return }
      if (!result.ok) { failure(result.code); return }
      setLocalConsent({ key: metadataKey, granted: nextGranted }); setCheckedKey(null)
      setNotice(t(nextGranted ? 'saved' : 'withdrawn')); router.refresh()
    } catch {
      if (currentMetadata.current === metadataKey) failure('UNKNOWN')
    } finally {
      flight.current = false
      if (currentMetadata.current !== null) setPending(false)
    }
  }

  return <section data-testid="marketing-preferences" aria-labelledby={id + '-title'}
    className="my-8 min-w-0 space-y-4 rounded-card bg-muted p-5 sm:p-6">
    <h2 id={id + '-title'} className="text-title">{t('title')}</h2>
    <p className="text-sm">{t(audience === 'student' ? 'studentDescription' : 'employerDescription')}</p>
    <p id={id + '-details'} className="text-sm text-muted-foreground">{t('independent')}</p>
    <Link href={'/' + locale + '/legal/privacy'} prefetch={false}
      className="inline-flex min-h-11 items-center text-sm text-brand underline underline-offset-4">{t('privacyPolicy')}</Link>
    {granted && <div className="space-y-2 rounded-control bg-background p-4">
      <p className="text-sm">{t('recorded')}</p>
      <Button type="button" variant="outline" disabled={!hydrated || pending} aria-busy={pending}
        onClick={() => void save(false)} className="h-auto min-h-11 whitespace-normal">{t('withdraw')}</Button>
    </div>}
    <div className="space-y-3">
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" checked={checked} disabled={!hydrated || pending || !canGrant} aria-describedby={id + '-details'}
          onChange={event => setCheckedKey(event.target.checked ? metadataKey : null)} className="mt-1 size-4 shrink-0" />
        <span>{t('consentLabel')}</span>
      </label>
      <Button type="button" disabled={!hydrated || pending || !checked || !canGrant} aria-busy={pending}
        onClick={() => void save(true)} className="h-auto min-h-11 whitespace-normal">{t('save')}</Button>
    </div>
    {!canGrant && <p className="rounded-control bg-background p-3 text-sm">{t('unavailable')}</p>}
    <p className="text-sm text-muted-foreground">{t('withdrawalNote')}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p ref={statusRef} role="status" aria-live="polite" tabIndex={-1}
      className="rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{pending ? t('saving') : notice}</p>
  </section>
}
