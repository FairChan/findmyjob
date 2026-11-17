'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  label: string
  pendingLabel?: string
  loading: boolean
  onConfirm: () => void
  className?: string
}

// Withdrawing is final: the same job cannot be applied to again (PRD §2.5), so ask first.
export function WithdrawConfirmButton({ label, pendingLabel, loading, onConfirm, className }: Props) {
  const t = useTranslations('withdrawConfirm')
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => setOpen(true)} className={className}>
        {loading && pendingLabel ? pendingLabel : label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
