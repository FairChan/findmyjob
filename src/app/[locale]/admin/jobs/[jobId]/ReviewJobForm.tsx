'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { approveJobAction, rejectJobAction } from '@/server/actions/admin-jobs'

interface Props {
  jobId: string
}

export function ReviewJobForm({ jobId }: Props) {
  const t = useTranslations('adminJobs')
  const router = useRouter()

  const [rejectNote, setRejectNote] = useState('')
  const [approveError, setApproveError] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [approveLoading, setApproveLoading] = useState(false)
  const [rejectLoading, setRejectLoading] = useState(false)

  async function handleApprove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setApproveError('')
    setApproveLoading(true)
    try {
      const res = await approveJobAction({ jobId })
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
      const res = await rejectJobAction({ jobId, reviewNote: rejectNote.trim() })
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

  return (
    <div className="grid gap-8 md:grid-cols-2 mt-6">
      {/* Approve section */}
      <form onSubmit={handleApprove} className="space-y-4 rounded-lg border p-5">
        <h3 className="font-semibold text-base">{t('approveTitle')}</h3>
        {approveError && <p className="text-sm text-destructive">{approveError}</p>}
        <Button type="submit" disabled={approveLoading} className="w-full">
          {approveLoading ? '…' : t('approveSubmit')}
        </Button>
      </form>

      {/* Reject section */}
      <form onSubmit={handleReject} className="space-y-4 rounded-lg border p-5">
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
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
