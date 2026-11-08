'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
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
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleWithdraw}
        disabled={loading}
        className="min-h-[36px]"
      >
        {loading ? t('withdrawing') : t('withdrawButton')}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
