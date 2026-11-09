'use client'

import { type FormEvent, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { createReportAction } from '@/server/actions/reports'

const reasons = ['ASKS_PAYMENT', 'FAKE_SALARY', 'ILLEGAL_WORK', 'MISMATCH', 'OTHER'] as const
type ErrorKey = 'errorInvalid' | 'errorLimit' | 'errorUnavailable' | 'errorForbidden' | 'errorGeneric'
const errorKeys: Record<string, ErrorKey> = {
  VALIDATION_ERROR: 'errorInvalid',
  RATE_LIMITED: 'errorLimit',
  NOT_FOUND: 'errorUnavailable',
  FORBIDDEN: 'errorForbidden',
}

export function ReportJobDialog({ jobId }: { jobId: string }) {
  const t = useTranslations('jobReports')
  const id = useId()
  const inFlight = useRef(false)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorKey | null>(null)
  const [success, setSuccess] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (inFlight.current) return
    if (nextOpen) {
      setError(null)
      setSuccess(false)
    }
    setOpen(nextOpen)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return

    const data = new FormData(event.currentTarget)
    const reason = reasons.find((value) => value === data.get('reason'))
    const note = String(data.get('note') ?? '').trim()
    setError(null)
    setSuccess(false)
    if (!reason || note.length > 1000) {
      setError('errorInvalid')
      return
    }

    inFlight.current = true
    setPending(true)
    try {
      const result = await createReportAction({ jobId, reason, note: note || undefined })
      if (!result.ok) {
        setError(errorKeys[result.code] ?? 'errorGeneric')
        return
      }
      setSuccess(true)
      setOpen(false)
    } catch {
      setError('errorGeneric')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <div className="mt-4 max-w-full">
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline">
            <Flag aria-hidden="true" />
            {t('trigger')}
          </Button>
        </DialogTrigger>
        <DialogContent
          closeLabel={t('close')}
          className="max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] overflow-y-auto rounded-lg"
          aria-busy={pending}
          onEscapeKeyDown={(event) => { if (inFlight.current) event.preventDefault() }}
          onPointerDownOutside={(event) => { if (inFlight.current) event.preventDefault() }}
        >
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
            <div className="space-y-2">
              <label htmlFor={`${id}-reason`} className="block text-sm font-medium">{t('reason')}</label>
              <select
                id={`${id}-reason`}
                name="reason"
                defaultValue={reasons[0]}
                required
                disabled={pending}
                className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {reasons.map((reason) => <option key={reason} value={reason}>{t(`reasons.${reason}`)}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-note`} className="block text-sm font-medium">{t('note')}</label>
              <textarea
                id={`${id}-note`}
                name="note"
                rows={4}
                maxLength={1000}
                disabled={pending}
                aria-describedby={`${id}-note-hint`}
                className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
              />
              <p id={`${id}-note-hint`} className="text-xs text-muted-foreground">{t('noteHint')}</p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('submitting') : t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <p role="status" aria-live="polite" aria-atomic="true" className={success ? 'mt-2 text-sm text-brand-muted-foreground' : 'sr-only'}>
        {success ? t('success') : ''}
      </p>
    </div>
  )
}
