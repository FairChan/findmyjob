'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { unlockStudentAction } from '@/server/actions/unlock'

export interface UnlockButtonLabels {
  button: string
  confirmTitle: string
  confirmDesc: string
  confirmCost: string
  confirmOk: string
  confirmCancel: string
  errorInsufficient: string
  errorRateLimit: string
  errorGeneric: string
}

export interface UnlockCreditsAdvice {
  text: string
  href?: string
}

interface Props {
  studentId: string
  labels: UnlockButtonLabels
  insufficientCreditsAdvice?: UnlockCreditsAdvice
}

export function UnlockButton({ studentId, labels, insufficientCreditsAdvice }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [insufficient, setInsufficient] = useState(false)

  function handleOpen() {
    setError(null)
    setInsufficient(false)
    setOpen(true)
  }

  function handleConfirm() {
    setError(null)
    setInsufficient(false)
    startTransition(async () => {
      const result = await unlockStudentAction({ studentId })
      if (result.ok) {
        setOpen(false)
        router.refresh()
      } else {
        if (result.code === 'INSUFFICIENT_CREDITS') {
          setError(labels.errorInsufficient)
          setInsufficient(true)
        } else if (result.code === 'RATE_LIMITED') {
          setError(labels.errorRateLimit)
        } else {
          setError(labels.errorGeneric)
        }
      }
    })
  }

  return (
    <>
      <Button variant="default" size="sm" onClick={handleOpen} data-testid="unlock-button">
        {labels.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.confirmTitle}</DialogTitle>
            <DialogDescription>{labels.confirmDesc}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {labels.confirmCost}
          </p>
          {error && (
            <div role="alert" className="min-w-0 space-y-2 text-sm text-destructive">
              <p>{error}</p>
              {insufficient && insufficientCreditsAdvice && (
                insufficientCreditsAdvice.href
                  ? <a href={insufficientCreditsAdvice.href} className="inline-flex min-h-11 items-center rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">{insufficientCreditsAdvice.text}</a>
                  : <p className="text-muted-foreground">{insufficientCreditsAdvice.text}</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              {labels.confirmCancel}
            </Button>
            <Button onClick={handleConfirm} disabled={isPending}>
              {isPending ? '…' : labels.confirmOk}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
