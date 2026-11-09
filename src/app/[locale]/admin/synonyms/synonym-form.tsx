'use client'

import { useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { saveSynonymGroupAction } from '@/server/actions/admin-growth'

interface Group { id: string; terms: string[]; active: boolean }

export function SynonymForm({ group }: { group?: Group }) {
  const t = useTranslations('adminSynonyms')
  const locale = useLocale()
  const router = useRouter()
  const id = useId()
  const inFlight = useRef(false)
  const [open, setOpen] = useState(false)
  const [terms, setTerms] = useState(group?.terms.join('\n') ?? '')
  const [active, setActive] = useState(group?.active ?? true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [saved, setSaved] = useState(false)

  function changeOpen(value: boolean) {
    if (inFlight.current) return
    if (value) {
      setTerms(group?.terms.join('\n') ?? '')
      setActive(group?.active ?? true)
      setError('')
      setAuthCode('')
      setSaved(false)
    }
    setOpen(value)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    setAuthCode('')
    const normalized = [...new Set(terms.split(/\r?\n/).map((term) => term.trim().toLowerCase()).filter(Boolean))]
    if (normalized.length < 2 || normalized.length > 50 || normalized.some((term) => term.length > 100)) {
      setError(t('errorInvalid'))
      return
    }
    inFlight.current = true
    setPending(true)
    try {
      const result = await saveSynonymGroupAction({ ...(group ? { id: group.id } : {}), terms: normalized, active })
      if (result.ok) {
        setOpen(false)
        setSaved(true)
        router.refresh()
      } else {
        setAuthCode(result.code)
        setError(t(result.code === 'VALIDATION_ERROR' ? 'errorInvalid' : result.code === 'NOT_FOUND' ? 'errorNotFound' : result.code === 'TWO_FACTOR_REQUIRED' ? 'errorTwoFactor' : ['FORBIDDEN', 'FRESH_SESSION_REQUIRED'].includes(result.code) ? 'errorForbidden' : 'errorGeneric'))
      }
    } catch {
      setError(t('errorGeneric'))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      {saved && <p role="status" className="max-w-md text-sm text-green-800">{t('saved')}</p>}
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger asChild><Button variant={group ? 'outline' : 'default'} size={group ? 'sm' : 'default'}>{t(group ? 'edit' : 'new')}</Button></DialogTrigger>
        <DialogContent closeLabel={t('close')} className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto rounded-xl" onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }} onPointerDownOutside={(event) => { if (pending) event.preventDefault() }}>
          <DialogHeader><DialogTitle>{t(group ? 'editTitle' : 'new')}</DialogTitle><DialogDescription>{t('description')}</DialogDescription></DialogHeader>
          <form data-testid="synonym-form" onSubmit={submit} className="min-w-0 space-y-4" aria-busy={pending}>
            <div className="space-y-2"><label htmlFor={id + '-terms'} className="text-sm font-medium">{t('terms')}</label><textarea id={id + '-terms'} value={terms} onChange={(event) => setTerms(event.target.value)} rows={8} required disabled={pending} aria-describedby={id + '-hint'} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-blue-600" /><p id={id + '-hint'} className="text-xs text-gray-600">{t('termsHint')}</p></div>
            <label className="flex min-h-10 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} disabled={pending} className="size-4 accent-blue-700" />{t('active')}</label>
            {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
            {['FORBIDDEN', 'FRESH_SESSION_REQUIRED', 'TWO_FACTOR_REQUIRED'].includes(authCode) && <a className="block text-sm text-blue-700 underline" href={'/' + locale + (authCode === 'TWO_FACTOR_REQUIRED' ? '/two-factor/setup' : '/login')}>{t(authCode === 'TWO_FACTOR_REQUIRED' ? 'setupTwoFactor' : 'signIn')}</a>}
            <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>{t('cancel')}</Button><Button type="submit" disabled={pending}>{t(pending ? 'saving' : 'save')}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

