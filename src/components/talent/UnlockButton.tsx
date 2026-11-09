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

interface Props {
  studentId: string
  labels: UnlockButtonLabels
}

export function UnlockButton({ studentId, labels }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleOpen() {
    setError(null)
    setOpen(true)
  }

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await unlockStudentAction({ studentId })
      if (result.ok) {
        setOpen(false)
        router.refresh()
      } else {
        if (result.code === 'INSUFFICIENT_CREDITS') {
          setError(labels.errorInsufficient)
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
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
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
