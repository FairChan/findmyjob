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
}

export function ApplyModal({ jobId, resumes, locale: _locale, incompleteStepPath }: ApplyModalProps) {
  const t = useTranslations('publicJobs')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [resumeId, setResumeId] = useState<string>('')
  const [coverNote, setCoverNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)

  if (incompleteStepPath) {
    return (
      <a
        href={incompleteStepPath}
        className="inline-flex items-center rounded-md bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground border hover:bg-muted/80 transition-colors min-h-[36px]"
      >
        {t('completeProfileButton')}
      </a>
    )
  }

  if (applied) {
    return (
      <span className="inline-flex items-center rounded-md bg-green-100 text-green-800 px-4 py-2 text-sm font-semibold min-h-[36px]">
        ✓ {t('appliedBadge')}
      </span>
    )
  }

  async function handleSubmit() {
    setLoading(true)
    setError(null)
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
        router.push(`/${_locale}/s/onboarding`)
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
        onClick={() => { setOpen(true); setError(null) }}
        className="min-h-[36px]"
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
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[36px]"
                >
                  <option value="">{t('applyDialogNoResume')}</option>
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fileName}{r.isPrimary ? ' ★' : ''}
                    </option>
                  ))}
                </select>
              </div>
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
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
              <p className="text-xs text-muted-foreground text-right">{coverNote.length}/500</p>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading} className="min-h-[36px]">
              {t('applyDialogCancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={loading} className="min-h-[36px]">
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
    <span className="inline-flex items-center rounded-md bg-muted text-muted-foreground px-4 py-2 text-sm font-semibold min-h-[36px]">
      {t('withdrawnBadge')}
    </span>
  )
}

interface AppliedStatusProps {
  applicationId: string
}

export function AppliedStatus({ applicationId }: AppliedStatusProps) {
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
      <span className="inline-flex items-center rounded-md bg-green-100 text-green-800 px-4 py-2 text-sm font-semibold min-h-[36px]">
        ✓ {t('appliedBadge')}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={handleWithdraw}
        disabled={loading}
        className="min-h-[36px] text-sm"
      >
        {t('withdrawButton')}
      </Button>
      {error && <p className="text-sm text-destructive w-full">{error}</p>}
    </div>
  )
}
