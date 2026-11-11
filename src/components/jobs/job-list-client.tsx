'use client'
import { useState, useTransition } from 'react'
import { Link, useRouter } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import type { JobListItem } from '@/app/[locale]/e/jobs/page'
import { copyJobAction, closeJobAction } from '@/app/[locale]/e/jobs/actions'
import { stateLabel } from '@/lib/my-states'

interface Props {
  jobs: JobListItem[]
  locale: string
  t: {
    emptyState: string
    statusDraft: string
    statusPendingReview: string
    statusPublished: string
    statusClosed: string
    statusRejected: string
    typeInternship: string
    typeFullTime: string
    typePartTime: string
    editButton: string
    copyButton: string
    closeButton: string
    confirmClose: string
    applications: string
    copySuccess: string
    closeSuccess: string
    errorUnknown: string
    errorForbidden: string
  }
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-foreground',
  PENDING_REVIEW: 'bg-warning-muted text-warning',
  PUBLISHED: 'bg-success-muted text-success',
  CLOSED: 'bg-destructive-muted text-destructive',
  REJECTED: 'bg-destructive-muted text-destructive',
}

export default function JobListClient({ jobs, locale, t }: Props) {
  const router = useRouter()
  const [localJobs, setLocalJobs] = useState(jobs)
  const [isPending, startTransition] = useTransition()
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  function getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      DRAFT: t.statusDraft,
      PENDING_REVIEW: t.statusPendingReview,
      PUBLISHED: t.statusPublished,
      CLOSED: t.statusClosed,
      REJECTED: t.statusRejected,
    }
    return map[status] ?? status
  }

  function getTypeLabel(type: string): string {
    const map: Record<string, string> = {
      INTERNSHIP: t.typeInternship,
      FULL_TIME: t.typeFullTime,
      PART_TIME: t.typePartTime,
    }
    return map[type] ?? type
  }

  function handleCopy(jobId: string) {
    setActionError(null)
    setActionSuccess(null)
    startTransition(async () => {
      const result = await copyJobAction({ jobId })
      if (!result.ok) {
        setActionError(result.code === 'FORBIDDEN' ? t.errorForbidden : t.errorUnknown)
        return
      }
      setActionSuccess(t.copySuccess)
    })
  }

  function handleClose(jobId: string) {
    if (!confirm(t.confirmClose)) return
    setActionError(null)
    setActionSuccess(null)
    startTransition(async () => {
      const result = await closeJobAction({ jobId })
      if (!result.ok) {
        setActionError(result.code === 'FORBIDDEN' ? t.errorForbidden : t.errorUnknown)
        return
      }
      setLocalJobs(prev =>
        prev.map(j => (j.id === jobId ? { ...j, status: result.data.status as typeof j.status } : j)),
      )
      setActionSuccess(t.closeSuccess)
      router.refresh()
    })
  }

  if (localJobs.length === 0) {
    return <p className="py-12 text-center text-muted-foreground">{t.emptyState}</p>
  }

  return (
    <div>
      {actionError && (
        <p className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">{actionError}</p>
      )}
      {actionSuccess && (
        <p className="mb-4 rounded bg-success-muted p-3 text-sm text-success">{actionSuccess}</p>
      )}
      <div className="divide-y rounded-card border">
        {localJobs.map(job => {
          const canClose = job.status === 'PUBLISHED' || job.status === 'PENDING_REVIEW'
          return (
            <div key={job.id} className="flex items-start justify-between p-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/e/jobs/${job.id}/edit`}
                    className="font-medium hover:underline truncate"
                  >
                    {job.title}
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[job.status] ?? ''}`}
                  >
                    {getStatusLabel(job.status)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {getTypeLabel(job.type)}
                  {job.state ? ` · ${stateLabel(job.state, locale)}` : ''}
                  {job.city ? ` ${job.city}` : ''}
                  {' · '}
                  {t.applications}: {job._count.applications}
                </p>
              </div>
              <div className="ml-4 flex shrink-0 gap-2">
                <Link
                  href={`/e/jobs/${job.id}/edit`}
                  className="rounded-control border px-3 py-1.5 text-xs font-medium hover:bg-muted/50"
                >
                  {t.editButton}
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleCopy(job.id)}
                  className="text-xs"
                >
                  {t.copyButton}
                </Button>
                {canClose && job.status !== 'CLOSED' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleClose(job.id)}
                    className="text-xs text-destructive hover:text-destructive"
                  >
                    {t.closeButton}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
