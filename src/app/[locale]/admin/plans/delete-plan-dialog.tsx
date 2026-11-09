'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { deletePlanAction } from '@/server/actions/admin-plans'
import { PlanActionError } from './plan-action-error'
import { usePlanFeedback } from './plan-feedback'

export function DeletePlanDialog({ id, name, protectedPlan }: { id: string; name: string; protectedPlan: boolean }) {
  const t = useTranslations('adminPlans')
  const errorId = useId()
  const feedback = usePlanFeedback()
  const inFlight = useRef(false)
  const succeeded = useRef(false)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [errorCode, setErrorCode] = useState('')

  function changeOpen(value: boolean) {
    if (inFlight.current || (value && (protectedPlan || feedback.refreshing))) return
    if (value) { setErrorCode(''); succeeded.current = false }
    setOpen(value)
  }

  async function remove() {
    if (inFlight.current || protectedPlan) return
    inFlight.current = true
    setPending(true)
    setErrorCode('')
    try {
      const result = await deletePlanAction({ id })
      if (result.ok) {
        succeeded.current = true
        feedback.announce(t('deleted'))
        setOpen(false)
        feedback.refresh()
      } else {
        setErrorCode(result.code)
      }
    } catch {
      setErrorCode('UNKNOWN')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" disabled={protectedPlan || feedback.refreshing}>{t('delete')}</Button></DialogTrigger>
      <DialogContent closeLabel={t('close')} className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto rounded-xl [&>button]:hidden" aria-busy={pending}
        onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (pending) event.preventDefault() }}
        onCloseAutoFocus={(event) => { if (succeeded.current) { event.preventDefault(); feedback.focusHeading() } }}>
        <DialogHeader className="pr-9">
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">{t('deleteDescription', { name })}</DialogDescription>
          <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2" aria-label={t('close')} disabled={pending} onClick={() => changeOpen(false)}><span aria-hidden="true" className="text-xl">×</span></Button>
        </DialogHeader>
        <PlanActionError id={errorId} code={errorCode} operation="delete" />
        <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>{t('cancel')}</Button><Button type="button" variant="destructive" disabled={pending} onClick={remove}>{t(pending ? 'deleting' : 'confirmDelete')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
