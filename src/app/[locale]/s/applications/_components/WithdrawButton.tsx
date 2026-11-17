'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { WithdrawConfirmButton } from '@/components/apply/WithdrawConfirmButton'
import { withdrawApplicationAction } from '@/server/actions/applications'

interface Props {
  applicationId: string
}

export function WithdrawButton({ applicationId }: Props) {
  const t = useTranslations('myApplications')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [withdrawn, setWithdrawn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (withdrawn) {
    return (
      <span className="text-sm text-muted-foreground">{t('withdrawSuccess')}</span>
    )
  }

  async function handleWithdraw() {
    setLoading(true)
    setError(null)
    try {
      const result = await withdrawApplicationAction({ applicationId })
      if (result.ok) {
        setWithdrawn(true)
        router.refresh()
      } else {
        setError(t('withdrawError'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <WithdrawConfirmButton
        label={t('withdrawButton')}
        pendingLabel={t('withdrawing')}
        loading={loading}
        onConfirm={() => void handleWithdraw()}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
