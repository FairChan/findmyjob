'use client'

import { useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { voidReferralAction } from '@/server/actions/admin-growth'
import { useAdminActionFeedback } from '@/components/admin/admin-action-feedback'

export function ReferralActions({ referralId }: { referralId: string }) {
  const t = useTranslations('adminGrowth')
  const locale = useLocale()
  const router = useRouter()
  const id = useId()
  const inFlight = useRef(false)
  const succeeded = useRef(false)
  const { announce, focusFeedback } = useAdminActionFeedback()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [authCode, setAuthCode] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    setAuthCode('')
    if (!reason.trim() || reason.trim().length > 500) {
      setError(t('errorInvalid'))
      return
    }
    inFlight.current = true
    setPending(true)
    try {
      const result = await voidReferralAction({ referralId, reason: reason.trim() })
      if (result.ok) {
        succeeded.current = true
        announce(t('saved'))
        setOpen(false)
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
    <div>
      <Dialog open={open} onOpenChange={(value) => { if (!inFlight.current) { setOpen(value); setError(''); setAuthCode('') } }}>
        <DialogTrigger asChild><Button variant="outline" size="sm">{t('void')}</Button></DialogTrigger>
        <DialogContent closeLabel={t('close')} className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto rounded-xl" onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }} onPointerDownOutside={(event) => { if (pending) event.preventDefault() }} onCloseAutoFocus={(event) => {
          if (succeeded.current) {
            event.preventDefault()
            focusFeedback()
            succeeded.current = false
          }
        }}>
          <DialogHeader><DialogTitle>{t('void')}</DialogTitle><DialogDescription>{t('voidDescription')}</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="min-w-0 space-y-4" aria-busy={pending}>
            <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium">{t('reason')}</label><textarea id={id} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required rows={4} disabled={pending} aria-describedby={id + '-hint'} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-blue-600" /><p id={id + '-hint'} className="text-xs text-gray-600">{t('reasonHint')}</p></div>
            {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
            {['FORBIDDEN', 'FRESH_SESSION_REQUIRED', 'TWO_FACTOR_REQUIRED'].includes(authCode) && <a className="block text-sm text-blue-700 underline" href={'/' + locale + (authCode === 'TWO_FACTOR_REQUIRED' ? '/two-factor/setup' : '/login')}>{t(authCode === 'TWO_FACTOR_REQUIRED' ? 'setupTwoFactor' : 'signIn')}</a>}
            <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>{t('cancel')}</Button><Button type="submit" disabled={pending}>{t(pending ? 'saving' : 'confirmVoid')}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

