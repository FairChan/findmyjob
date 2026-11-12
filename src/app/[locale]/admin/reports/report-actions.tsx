'use client'

import { useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { resolveReportAction } from '@/server/actions/admin-reports'
import { useAdminActionFeedback } from '@/components/admin/admin-action-feedback'

function ReportDecision({ reportId, status }: { reportId: string; status: 'RESOLVED' | 'DISMISSED' }) {
  const t = useTranslations('adminReports')
  const locale = useLocale()
  const router = useRouter()
  const inFlight = useRef(false)
  const succeeded = useRef(false)
  const { announce, focusFeedback } = useAdminActionFeedback()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [authCode, setAuthCode] = useState('')
  const resolving = status === 'RESOLVED'

  async function submit() {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError('')
    setAuthCode('')
    try {
      const result = await resolveReportAction({ reportId, status })
      if (result.ok) {
        succeeded.current = true
        announce(t('saved'))
        setOpen(false)
        router.refresh()
      } else {
        setAuthCode(result.code)
        setError(t(result.code === 'CONFLICT' ? 'errorConflict' : result.code === 'NOT_FOUND' ? 'errorNotFound' : result.code === 'VALIDATION_ERROR' ? 'errorInvalid' : result.code === 'TWO_FACTOR_REQUIRED' ? 'errorTwoFactor' : ['FORBIDDEN', 'FRESH_SESSION_REQUIRED'].includes(result.code) ? 'errorForbidden' : 'errorGeneric'))
      }
    } catch {
      setError(t('errorGeneric'))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!inFlight.current) { setOpen(value); setError(''); setAuthCode('') } }}>
      <DialogTrigger asChild><Button size="sm" variant={resolving ? 'default' : 'outline'}>{t(resolving ? 'resolve' : 'dismiss')}</Button></DialogTrigger>
      <DialogContent closeLabel={t('close')} className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto rounded-card" onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }} onPointerDownOutside={(event) => { if (pending) event.preventDefault() }} onCloseAutoFocus={(event) => {
        if (succeeded.current) {
          event.preventDefault()
          focusFeedback()
          succeeded.current = false
        }
      }}>
        <DialogHeader><DialogTitle>{t(resolving ? 'resolve' : 'dismiss')}</DialogTitle><DialogDescription>{t(resolving ? 'resolveDescription' : 'dismissDescription')}</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {['FORBIDDEN', 'FRESH_SESSION_REQUIRED', 'TWO_FACTOR_REQUIRED'].includes(authCode) && <a className="text-sm text-brand underline" href={'/' + locale + (authCode === 'TWO_FACTOR_REQUIRED' ? '/two-factor/setup' : '/login')}>{t(authCode === 'TWO_FACTOR_REQUIRED' ? 'setupTwoFactor' : 'signIn')}</a>}
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>{t('cancel')}</Button><Button type="button" disabled={pending} onClick={submit}>{t(pending ? 'saving' : resolving ? 'confirmResolve' : 'confirmDismiss')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ReportActions({ reportId }: { reportId: string }) {
  return <div className="flex flex-wrap gap-2"><ReportDecision reportId={reportId} status="RESOLVED" /><ReportDecision reportId={reportId} status="DISMISSED" /></div>
}

