'use client'
import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { recommendTalentsAction } from '@/server/actions/semantic-matching'
import type { TalentCard } from '@/server/serializers/talent-card'
import { MatchingTalentCards } from './MatchingCards'
import { matchingErrorKey } from './matching-ui'

export interface EmployerMatchingPanelProps { locale: string; job: { id: string; title: string } }
export function EmployerMatchingPanel({ locale, job }: EmployerMatchingPanelProps) {
  const t = useTranslations('matching'), id = useId()
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [result, setResult] = useState<{ jobId: string; items: TalentCard[] } | null>(null)
  const inFlight = useRef(false), source = useRef(job.id)
  useEffect(() => { source.current = job.id; return () => { source.current = '' } }, [job.id])
  async function request() {
    if (inFlight.current) return
    inFlight.current = true; setPending(true); setError(''); setNotice(''); setResult(null)
    const requestedId = job.id
    try {
      const response = await recommendTalentsAction({ jobId: requestedId, limit: 10 })
      if (source.current !== requestedId) return
      if (!response.ok) { setError(t(matchingErrorKey(response.code))); return }
      if (response.data.availability === 'unavailable') { setNotice(t('unavailable')); return }
      setResult({ jobId: requestedId, items: response.data.items }); setNotice(t(response.data.items.length ? 'loaded' : 'empty'))
    } catch { if (source.current === requestedId) setError(t('error.generic')) }
    finally { inFlight.current = false; setPending(false) }
  }
  return <section data-testid="employer-matching-panel" aria-labelledby={id + '-title'} className="min-w-0 space-y-4 rounded-card bg-muted p-5 sm:p-6">
    <h2 id={id + '-title'} className="text-title">{t('employerTitle')}</h2>
    <p className="font-medium [overflow-wrap:anywhere]">{job.title}</p>
    <p className="text-sm text-muted-foreground">{t('employerDescription')}</p>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="brand" disabled={pending} aria-busy={pending} onClick={() => void request()} className="h-auto min-h-11 whitespace-normal">{t('requestTalent')}</Button>
      <Link href={'/' + locale + '/e/talent'} prefetch={false} className="inline-flex min-h-11 items-center text-sm text-brand underline underline-offset-4">{t('searchTalent')}</Link>
    </div>
    {result?.jobId === job.id && result.items.length > 0 && <div className="space-y-3"><h3 className="font-semibold">{t('results')}</h3><MatchingTalentCards items={result.items} locale={locale} /></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p role="status" aria-live="polite" className="text-sm">{pending ? t('pending') : notice}</p>
  </section>
}
