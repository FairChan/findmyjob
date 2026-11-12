'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { approveCompanyAction, rejectCompanyAction } from '@/server/actions/admin-verification'
import type { ReviewChannel } from '@/server/services/review-company'

const CHANNELS: { key: ReviewChannel; labelKey: 'channelSSM' | 'channelWebsite' | 'channelPhone' }[] =
  [
    { key: 'SSM', labelKey: 'channelSSM' },
    { key: 'WEBSITE', labelKey: 'channelWebsite' },
    { key: 'PHONE', labelKey: 'channelPhone' },
  ]

interface Props {
  verificationId: string
  companyId: string
}

export function ReviewForm({ verificationId, companyId }: Props) {
  const t = useTranslations('adminCompanies')
  const router = useRouter()

  const [channels, setChannels] = useState<ReviewChannel[]>([])
  const [result, setResult] = useState('')
  const [rejectNote, setRejectNote] = useState('')
  const [approveError, setApproveError] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [approveLoading, setApproveLoading] = useState(false)
  const [rejectLoading, setRejectLoading] = useState(false)

  function toggleChannel(ch: ReviewChannel) {
    setChannels(prev =>
      prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch],
    )
  }

  async function handleApprove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setApproveError('')
    if (channels.length === 0) {
      setApproveError(t('errorChannelsRequired'))
      return
    }
    if (!result.trim()) {
      setApproveError(t('errorResultRequired'))
      return
    }
    setApproveLoading(true)
    try {
      const res = await approveCompanyAction({
        verificationId,
        verifiedChannels: channels,
        verificationResult: result.trim(),
      })
      if (res.ok) {
        router.push('.')
        router.refresh()
      } else {
        setApproveError(t('errorFailed'))
      }
    } finally {
      setApproveLoading(false)
    }
  }

  async function handleReject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setRejectError('')
    if (!rejectNote.trim()) {
      setRejectError(t('errorNoteRequired'))
      return
    }
    setRejectLoading(true)
    try {
      const res = await rejectCompanyAction({
        verificationId,
        reviewNote: rejectNote.trim(),
      })
      if (res.ok) {
        router.push('.')
        router.refresh()
      } else {
        setRejectError(t('errorFailed'))
      }
    } finally {
      setRejectLoading(false)
    }
  }

  // suppress unused var warning — companyId reserved for future navigation
  void companyId

  return (
    <div className="grid gap-8 md:grid-cols-2 mt-6">
      {/* Approve section */}
      <form onSubmit={handleApprove} className="space-y-4 rounded-card border p-5">
        <h3 className="font-semibold text-base">{t('approveTitle')}</h3>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">{t('channelsLabel')}</legend>
          {CHANNELS.map(ch => (
            <div key={ch.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`ch-${ch.key}`}
                checked={channels.includes(ch.key)}
                onChange={() => toggleChannel(ch.key)}
                className="h-4 w-4 rounded border-border"
              />
              <label htmlFor={`ch-${ch.key}`} className="text-sm font-normal cursor-pointer">
                {t(ch.labelKey)}
              </label>
            </div>
          ))}
        </fieldset>

        <div className="space-y-1">
          <label htmlFor="verify-result" className="text-sm font-medium block">
            {t('resultLabel')}
          </label>
          <textarea
            id="verify-result"
            value={result}
            onChange={e => setResult(e.target.value)}
            placeholder={t('resultPlaceholder')}
            rows={3}
            className="w-full rounded-control border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {approveError && <p className="text-sm text-destructive">{approveError}</p>}

        <Button type="submit" disabled={approveLoading} className="w-full">
          {approveLoading ? '…' : t('approveSubmit')}
        </Button>
      </form>

      {/* Reject section */}
      <form onSubmit={handleReject} className="space-y-4 rounded-card border p-5">
        <h3 className="font-semibold text-base">{t('rejectTitle')}</h3>

        <div className="space-y-1">
          <label htmlFor="reject-note" className="text-sm font-medium block">
            {t('rejectNoteLabel')}
          </label>
          <textarea
            id="reject-note"
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            placeholder={t('rejectNotePlaceholder')}
            rows={3}
            className="w-full rounded-control border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {rejectError && <p className="text-sm text-destructive">{rejectError}</p>}

        <Button
          type="submit"
          variant="destructive"
          disabled={rejectLoading}
          className="w-full"
        >
          {rejectLoading ? '…' : t('rejectSubmit')}
        </Button>
      </form>
    </div>
  )
}
