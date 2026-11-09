'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { InviteDialog } from './InviteDialog'
import type { InviteJob } from './InviteDialog'

interface Props {
  canPurchase?: boolean
  studentId: string
  jobs: InviteJob[]
  usedQuota: number
  totalQuota: number | null
}

export function InviteButton({ studentId, jobs, usedQuota, totalQuota, canPurchase = false }: Props) {
  const t = useTranslations('invitations')
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('inviteButton')}
      </Button>
      <InviteDialog
        studentId={studentId}
        jobs={jobs}
        usedQuota={usedQuota}
        totalQuota={totalQuota}
        canPurchase={canPurchase}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
