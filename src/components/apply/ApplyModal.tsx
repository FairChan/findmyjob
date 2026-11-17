'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { applyToJobAction, withdrawApplicationAction } from '@/server/actions/applications'
import { WithdrawConfirmButton } from './WithdrawConfirmButton'
import type { ApplicationBlocker } from '@/lib/application-readiness'

export interface ResumeOption {
  id: string
  fileName: string
  isPrimary: boolean
}

interface ApplyModalProps {
  jobId: string
  resumes: ResumeOption[]
  locale: string
  incompleteStepPath: string | null
  blocker?: ApplicationBlocker | null
}

export function ApplyModal({ jobId, resumes, locale, incompleteStepPath, blocker }: ApplyModalProps) {
  const t = useTranslations('publicJobs')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [resumeId, setResumeId] = useState<string>(() => resumes.find(r => r.isPrimary)?.id ?? resumes[0]?.id ?? '')
  const [coverNote, setCoverNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const [repairPath, setRepairPath] = useState<string | null>(null)

  if (incompleteStepPath) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {t(blocker === 'contactAndResume' ? 'applyBlockedContactAndResume'
            : blocker === 'contact' ? 'applyBlockedContact'
              : blocker === 'resume' ? 'applyBlockedResume' : 'applyBlockedProfile')}
        </p>
        <a
          href={incompleteStepPath}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
        >
          {t('completeProfileButton')}
        </a>
      </div>
    )
  }

  if (applied) {
    return (
      <span className="inline-flex min-h-9 items-center rounded-full bg-success-muted px-4 text-sm font-semibold text-success">
        ✓ {t('appliedBadge')}
      </span>
    )
  }

  async function handleSubmit() {
    setLoading(true)
    setError(null)
    setRepairPath(null)
    try {
      const result = await applyToJobAction({
        jobId,
        resumeId: resumeId || null,
        coverNote: coverNote.trim() || null,
      })
      if (result.ok) {
        setApplied(true)
        setOpen(false)
        router.refresh()
      } else if (result.code === 'DUPLICATE_APPLICATION') {
        setError(t('applyErrorDuplicate'))
        setApplied(true)
        setOpen(false)
      } else if (result.code === 'COMPLETENESS_LOW') {
        setError(t('applyBlockedProfile'))
        setRepairPath(`/${locale}/s/profile`)
      } else if (result.code === 'CONTACT_REQUIRED' || result.code === 'RESUME_REQUIRED') {
        setError(t(result.code === 'CONTACT_REQUIRED' ? 'applyBlockedContact' : 'applyBlockedResume'))
        setRepairPath(`/${locale}/s/onboarding`)
      } else {
        setError(t('applyErrorGeneral'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        variant="brand"
        size="lg"
        onClick={() => { setOpen(true); setError(null); setRepairPath(null) }}
        className="w-full"
      >
        {t('applyButton')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('applyDialogTitle')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {resumes.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="apply-resume">{t('applyDialogResume')}</Label>
                <select
                  id="apply-resume"
                  value={resumeId}
                  onChange={(e) => setResumeId(e.target.value)}
                  className="flex h-9 w-full rounded-control border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[36px]"
                >
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fileName}{r.isPrimary ? ' ★' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {resumes.length === 0 && (
              <p className="text-sm text-destructive">
                {t('applyBlockedResume')}{' '}
                <a href={`/${locale}/s/onboarding`} className="underline">{t('completeProfileButton')}</a>
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="apply-cover">{t('applyDialogCoverNote')}</Label>
              <textarea
                id="apply-cover"
                placeholder={t('applyDialogCoverNotePlaceholder')}
                value={coverNote}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCoverNote(e.target.value)}
                maxLength={500}
                rows={4}
                className="flex w-full rounded-control border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
              <p className="text-xs text-muted-foreground text-right">{coverNote.length}/500</p>
            </div>

            {error && (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>{error}</p>
                {repairPath && <a href={repairPath} className="underline">{t('completeProfileButton')}</a>}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading} className="min-h-[36px]">
              {t('applyDialogCancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={loading || resumes.length === 0 || !!repairPath} className="min-h-[36px]">
              {loading ? '…' : t('applyDialogSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function WithdrawnStatus() {
  const t = useTranslations('publicJobs')
  return (
    <span className="inline-flex min-h-9 items-center rounded-full bg-background px-4 text-sm font-semibold text-muted-foreground">
      {t('withdrawnBadge')}
    </span>
  )
}

interface AppliedStatusProps {
  applicationId: string
  /** False once the company has reached an outcome (offer, hired, rejected). */
  canWithdraw?: boolean
}

export function AppliedStatus({ applicationId, canWithdraw = true }: AppliedStatusProps) {
  const t = useTranslations('publicJobs')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [withdrawn, setWithdrawn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (withdrawn) {
    return <span className="text-sm text-muted-foreground">{t('withdrawSuccess')}</span>
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
        setError(t('withdrawErrorGeneral'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="inline-flex min-h-9 items-center rounded-full bg-success-muted px-4 text-sm font-semibold text-success">
        ✓ {t('appliedBadge')}
      </span>
      {canWithdraw && (
        <WithdrawConfirmButton
          label={t('withdrawButton')}
          loading={loading}
          onConfirm={() => void handleWithdraw()}
          className="min-h-[36px] text-sm"
        />
      )}
      {error && <p className="text-sm text-destructive w-full">{error}</p>}
    </div>
  )
}
