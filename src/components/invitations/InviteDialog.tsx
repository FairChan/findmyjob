'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { sendInvitationAction } from '@/server/actions/invitations'

export interface InviteJob {
  id: string
  title: string
}

interface Props {
  studentId: string
  jobs: InviteJob[]
  usedQuota: number
  totalQuota: number
  open: boolean
  onClose: () => void
}

export function InviteDialog({ studentId, jobs, usedQuota, totalQuota, open, onClose }: Props) {
  const t = useTranslations('invitations')
  const router = useRouter()
  const [jobId, setJobId] = useState(jobs[0]?.id ?? '')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit() {
    if (!jobId) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await sendInvitationAction({ studentId, jobId, message: message.trim() || null })
      if (result.ok) {
        setSuccess(true)
        router.refresh()
        setTimeout(() => {
          setSuccess(false)
          onClose()
        }, 1200)
      } else {
        if (result.code === 'INVITATION_QUOTA_EXCEEDED') {
          setError(t('inviteErrorQuota'))
        } else if (result.code === 'DUPLICATE_APPLICATION') {
          setError(t('inviteAlreadyApplied'))
        } else if (result.code === 'NOT_FOUND') {
          setError(t('inviteAlreadyExists'))
        } else {
          setError(t('inviteErrorGeneral'))
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (jobs.length === 0) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('inviteDialogTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('inviteNoJobs')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>{t('inviteDialogCancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('inviteDialogTitle')}</DialogTitle>
        </DialogHeader>

        {success ? (
          <p className="rounded-md bg-green-50 p-3 text-sm text-green-700">{t('inviteSuccess')}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-job">{t('inviteDialogJobLabel')}</Label>
              <select
                id="invite-job"
                value={jobId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setJobId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-message">{t('inviteDialogMessageLabel')}</Label>
              <textarea
                id="invite-message"
                value={message}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
                placeholder={t('inviteDialogMessagePlaceholder')}
                maxLength={500}
                rows={4}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {t('inviteDialogQuota', { used: usedQuota, quota: totalQuota })}
            </p>

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
          </div>
        )}

        {!success && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              {t('inviteDialogCancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !jobId}>
              {t('inviteDialogSubmit')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
