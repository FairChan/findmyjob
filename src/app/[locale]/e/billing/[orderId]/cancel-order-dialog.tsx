'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useAdminActionFeedback } from '@/components/admin/admin-action-feedback'
import { cancelPendingOrderAction } from '@/server/actions/billing'
import { BillingError } from '../billing-error'

export function CancelOrderDialog({ orderId, orderNo }: { orderId: string; orderNo: string }) {
  const t = useTranslations('billing')
  const router = useRouter()
  const feedback = useAdminActionFeedback()
  const inFlight = useRef(false)
  const succeeded = useRef(false)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  function changeOpen(value: boolean) {
    if (inFlight.current) return
    if (value) { setError(''); succeeded.current = false }
    setOpen(value)
  }
  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      const result = await cancelPendingOrderAction({ orderId })
      if (result.ok) {
        succeeded.current = true
        feedback.announce(t('cancelled'))
        setOpen(false)
        router.refresh()
      } else setError(result.code)
    } catch { setError('UNKNOWN') }
    finally { inFlight.current = false; setPending(false) }
  }
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button variant="outline">{t('cancelOrder')}</Button></DialogTrigger>
    <DialogContent closeLabel={t('close')} className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto rounded-xl" onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }} onPointerDownOutside={(event) => { if (pending) event.preventDefault() }} onCloseAutoFocus={(event) => { if (succeeded.current) { event.preventDefault(); feedback.focusFeedback() } }}>
      <DialogHeader><DialogTitle>{t('cancelOrder')}</DialogTitle><DialogDescription className="break-words [overflow-wrap:anywhere]">{t('cancelDescription', { orderNo })}</DialogDescription></DialogHeader>
      <form onSubmit={cancel} aria-busy={pending} className="space-y-4">
        <BillingError code={error} operation="cancel" />
        <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>{t('keepOrder')}</Button><Button type="submit" variant="destructive" disabled={pending} className="h-auto min-h-10 whitespace-normal">{t(pending ? 'cancelling' : 'confirmCancel')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
