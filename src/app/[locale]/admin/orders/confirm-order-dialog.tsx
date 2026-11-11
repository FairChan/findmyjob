'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useAdminActionFeedback } from '@/components/admin/admin-action-feedback'
import { confirmBankOrderAction } from '@/server/actions/billing'

function parseAmount(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, decimal = ''] = trimmed.split('.')
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 2_147_483_647 ? amount : null
}

export function ConfirmOrderDialog({ orderId, orderNo, amountSen }: { orderId: string; orderNo: string; amountSen: number }) {
  const t = useTranslations('adminOrders')
  const locale = useLocale()
  const router = useRouter()
  const feedback = useAdminActionFeedback()
  const id = useId()
  const inFlight = useRef(false)
  const succeeded = useRef(false)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  function changeOpen(value: boolean) {
    if (inFlight.current) return
    if (value) { setAmount(''); setNote(''); setError(''); succeeded.current = false }
    setOpen(value)
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    const receivedAmountSen = parseAmount(amount)
    if (receivedAmountSen === null || !note.trim() || note.trim().length > 1000) { setError('VALIDATION_ERROR'); return }
    if (receivedAmountSen !== amountSen) { setError('AMOUNT_MISMATCH'); return }
    inFlight.current = true
    setPending(true)
    try {
      const result = await confirmBankOrderAction({ orderId, receivedAmountSen, note: note.trim() })
      if (result.ok) {
        succeeded.current = true
        feedback.announce(t(result.data.alreadyPaid ? 'alreadyPaid' : 'confirmed'))
        setOpen(false)
        router.refresh()
      } else setError(result.code)
    } catch { setError('UNKNOWN') }
    finally { inFlight.current = false; setPending(false) }
  }
  const errorKey = error === 'AMOUNT_MISMATCH' ? 'mismatch' : error === 'FRESH_SESSION_REQUIRED' ? 'fresh' : error === 'VALIDATION_ERROR' ? 'errorInvalid' : error === 'FORBIDDEN' ? 'errorForbidden' : error === 'TWO_FACTOR_REQUIRED' ? 'errorTwoFactor' : error === 'NOT_FOUND' ? 'errorNotFound' : error === 'CONFLICT' ? 'errorConflict' : 'errorGeneric'
  const needsAuth = ['FORBIDDEN', 'FRESH_SESSION_REQUIRED', 'TWO_FACTOR_REQUIRED'].includes(error)
  const fieldClass = 'w-full min-w-0 rounded-card border border-border bg-card px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-brand disabled:bg-muted'
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="sm" className="h-auto min-h-10 whitespace-normal">{t('confirm')}</Button></DialogTrigger>
    <DialogContent closeLabel={t('close')} className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto rounded-card" onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }} onPointerDownOutside={(event) => { if (pending) event.preventDefault() }} onCloseAutoFocus={(event) => { if (succeeded.current) { event.preventDefault(); feedback.focusFeedback() } }}>
      <DialogHeader><DialogTitle>{t('confirm')}</DialogTitle><DialogDescription className="break-words [overflow-wrap:anywhere]">{t('confirmDescription', { orderNo })}</DialogDescription></DialogHeader>
      <form onSubmit={confirm} noValidate aria-busy={pending} aria-describedby={error ? id + '-error' : undefined} className="min-w-0 space-y-4">
        <div className="space-y-2"><label htmlFor={id + '-amount'} className="block text-sm font-medium">{t('amount')}</label><input id={id + '-amount'} name="receivedAmount" type="text" inputMode="decimal" autoComplete="off" required value={amount} onChange={(event) => setAmount(event.target.value)} disabled={pending} aria-describedby={id + '-amount-hint'} className={fieldClass} /><p id={id + '-amount-hint'} className="text-xs text-muted-foreground">{t('amountHint')}</p></div>
        <div className="space-y-2"><label htmlFor={id + '-note'} className="block text-sm font-medium">{t('note')}</label><textarea id={id + '-note'} name="note" rows={4} required maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} disabled={pending} aria-describedby={id + '-note-hint'} className={fieldClass} /><p id={id + '-note-hint'} className="text-xs text-muted-foreground">{t('noteHint')}</p></div>
        {error && <p id={id + '-error'} role="alert" className="text-sm text-destructive">{t(errorKey)}</p>}
        {needsAuth && <a href={'/' + locale + (error === 'TWO_FACTOR_REQUIRED' ? '/two-factor/setup' : '/login')} className="inline-flex min-h-10 items-center text-sm text-brand underline">{t(error === 'TWO_FACTOR_REQUIRED' ? 'setupTwoFactor' : 'signIn')}</a>}
        {['CONFLICT', 'NOT_FOUND'].includes(error) && <Button type="button" variant="outline" disabled={pending} onClick={() => { setOpen(false); router.refresh() }} className="h-auto min-h-10 whitespace-normal">{t('reload')}</Button>}
        <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>{t('cancel')}</Button><Button type="submit" disabled={pending} aria-busy={pending} className="h-auto min-h-10 whitespace-normal">{t('confirm')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
