'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { sendInvitationAction } from '@/server/actions/invitations'
import { EntitlementLimitNotice } from '@/components/billing/entitlement-limit-notice'

export interface InviteJob {
  id: string
  title: string
}

interface Props {
  canPurchase?: boolean
  studentId: string
  jobs: InviteJob[]
  usedQuota: number
  totalQuota: number | null
  open: boolean
  onClose: () => void
}

export function InviteDialog({ studentId, jobs, usedQuota, totalQuota, open, onClose, canPurchase = false }: Props) {
  const t = useTranslations('invitations')
  const router = useRouter()
  const [jobId, setJobId] = useState(jobs[0]?.id ?? '')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limitReached, setLimitReached] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit() {
    if (!jobId) return
    setSubmitting(true)
    setError(null)
    setLimitReached(false)
    try {
      const result = await sendInvitationAction({ studentId, jobId, message: message.trim() || null })
      if (result.ok && result.data.alreadyExists) {
        // An unanswered invitation for this job already exists; nothing new reaches the student.
        setError(t('inviteAlreadyExists'))
      } else if (result.ok) {
        setSuccess(true)
        router.refresh()
        setTimeout(() => {
          setSuccess(false)
          onClose()
        }, 1200)
      } else {
        if (result.code === 'INVITATION_QUOTA_EXCEEDED') {
          setLimitReached(true)
        } else if (result.code === 'DUPLICATE_APPLICATION') {
          setError(t('inviteAlreadyApplied'))
        } else if (result.code === 'NOT_FOUND') {
          setError(t('inviteUnavailable'))
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
          <p className="rounded-control bg-success-muted p-3 text-sm text-success">{t('inviteSuccess')}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-job">{t('inviteDialogJobLabel')}</Label>
              <select
                id="invite-job"
                value={jobId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setJobId(e.target.value)}
                className="flex h-9 w-full rounded-control border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="flex w-full rounded-control border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <p className="rounded-card bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {totalQuota === null
                ? t('inviteDialogQuotaUnlimited', { used: usedQuota })
                : t('inviteDialogQuota', { used: usedQuota, quota: totalQuota })}
            </p>

            {error && (
              <p role="alert" className="rounded-control bg-destructive-muted px-3 py-2 text-sm text-destructive">{error}</p>
            )}
            {limitReached && <EntitlementLimitNotice resource="invitations" canPurchase={canPurchase} />}
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
