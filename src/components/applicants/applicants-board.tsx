'use client'
import { useState, useTransition, useCallback } from 'react'
import { ApplicationStatus } from '@prisma/client'
import type { ApplicantRow } from '@/server/services/applicants'
import type { ActionResult } from '@/server/action'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

type SortKey = 'cgpa' | 'graduationYear' | 'completeness'

interface Props {
  applicants: ApplicantRow[]
  locale: string
  t: {
    kanbanView: string
    listView: string
    noApplicants: string
    statusAPPLIED: string
    statusVIEWED: string
    statusSHORTLISTED: string
    statusINTERVIEW: string
    statusOFFER: string
    statusHIRED: string
    statusREJECTED: string
    statusWITHDRAWN: string
    noteLabel: string
    notePlaceholder: string
    noteSave: string
    noteSaving: string
    noteCancel: string
    noteSuccess: string
    sortByCgpa: string
    sortByGradYear: string
    sortByCompleteness: string
    changeStatusLabel: string
    errorUnknown: string
    errorForbidden: string
    coverNoteLabel: string
    identityLocked: string
    viewProfile: string
  }
  changeStatusAction: (input: { applicationId: string; toStatus: ApplicationStatus; note?: string | null }) => Promise<ActionResult<void>>
  updateNoteAction: (input: { applicationId: string; note: string | null }) => Promise<ActionResult<void>>
}

const STATUS_LABEL_KEY: Record<ApplicationStatus, keyof Props['t']> = {
  APPLIED: 'statusAPPLIED',
  VIEWED: 'statusVIEWED',
  SHORTLISTED: 'statusSHORTLISTED',
  INTERVIEW: 'statusINTERVIEW',
  OFFER: 'statusOFFER',
  HIRED: 'statusHIRED',
  REJECTED: 'statusREJECTED',
  WITHDRAWN: 'statusWITHDRAWN',
}

const KANBAN_COLS: ApplicationStatus[] = [
  ApplicationStatus.APPLIED,
  ApplicationStatus.VIEWED,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
  ApplicationStatus.HIRED,
  ApplicationStatus.REJECTED,
]

const COMPANY_SETTABLE: ApplicationStatus[] = [
  ApplicationStatus.VIEWED,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
  ApplicationStatus.HIRED,
  ApplicationStatus.REJECTED,
]

export default function ApplicantsBoard({ applicants: initialApplicants, locale, t, changeStatusAction, updateNoteAction }: Props) {
  const [applicants, setApplicants] = useState(initialApplicants)
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [sortKey, setSortKey] = useState<SortKey>('completeness')
  const [isPending, startTransition] = useTransition()

  // Note dialog state
  const [noteDialog, setNoteDialog] = useState<{ open: boolean; applicationId: string; current: string } | null>(null)
  const [noteValue, setNoteValue] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<ApplicationStatus | null>(null)

  const handleStatusChange = useCallback(
    (applicationId: string, toStatus: ApplicationStatus) => {
      startTransition(async () => {
        const res = await changeStatusAction({ applicationId, toStatus })
        if (res.ok) {
          setApplicants((prev) =>
            prev.map((a) => (a.applicationId === applicationId ? { ...a, status: toStatus } : a)),
          )
        }
      })
    },
    [changeStatusAction],
  )

  const openNoteDialog = (applicationId: string, current: string | null) => {
    setNoteDialog({ open: true, applicationId, current: current ?? '' })
    setNoteValue(current ?? '')
    setNoteError(null)
  }

  const handleNoteSave = () => {
    if (!noteDialog) return
    const { applicationId } = noteDialog
    setNoteError(null)
    startTransition(async () => {
      const res = await updateNoteAction({ applicationId, note: noteValue.trim() || null })
      if (res.ok) {
        setApplicants((prev) =>
          prev.map((a) =>
            a.applicationId === applicationId ? { ...a, companyNote: noteValue.trim() || null } : a,
          ),
        )
        setNoteDialog(null)
      } else {
        setNoteError(res.code === 'FORBIDDEN' ? t.errorForbidden : t.errorUnknown)
      }
    })
  }

  // ---- Drag and drop handlers ----
  const onDragStart = (applicationId: string) => setDraggingId(applicationId)
  const onDragEnd = () => { setDraggingId(null); setDragOverCol(null) }
  const onDragOver = (e: React.DragEvent, status: ApplicationStatus) => {
    e.preventDefault()
    setDragOverCol(status)
  }
  const onDrop = (e: React.DragEvent, toStatus: ApplicationStatus) => {
    e.preventDefault()
    if (draggingId && COMPANY_SETTABLE.includes(toStatus)) {
      handleStatusChange(draggingId, toStatus)
    }
    setDraggingId(null)
    setDragOverCol(null)
  }

  // ---- List view sort ----
  const sortedApplicants = [...applicants].sort((a, b) => {
    if (sortKey === 'cgpa') {
      const av = parseFloat(a.card.cgpa ?? '0')
      const bv = parseFloat(b.card.cgpa ?? '0')
      return bv - av
    }
    if (sortKey === 'graduationYear') {
      return (b.card.graduationYear ?? 0) - (a.card.graduationYear ?? 0)
    }
    return b.card.completeness - a.card.completeness
  })

  const pageSize = 10
  const [listPage, setListPage] = useState(0)
  const listStart = listPage * pageSize
  const listRows = sortedApplicants.slice(listStart, listStart + pageSize)
  const totalPages = Math.ceil(sortedApplicants.length / pageSize)

  if (applicants.length === 0) {
    return <p className="py-12 text-center text-muted-foreground">{t.noApplicants}</p>
  }

  return (
    <div>
      {/* View toggle */}
      <div className="mb-4 flex gap-2">
        <Button
          variant={view === 'kanban' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('kanban')}
        >
          {t.kanbanView}
        </Button>
        <Button
          variant={view === 'list' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('list')}
        >
          {t.listView}
        </Button>
      </div>

      {/* Kanban view */}
      {view === 'kanban' && (
        <div className="hidden gap-3 md:flex" aria-label="applicants-kanban">
          {KANBAN_COLS.map((col) => {
            const colApplicants = applicants.filter((a) => a.status === col)
            const isDropTarget = COMPANY_SETTABLE.includes(col)
            return (
              <div
                key={col}
                className={`min-w-[160px] flex-1 rounded-lg border p-2 ${dragOverCol === col ? 'bg-muted/60' : 'bg-muted/20'}`}
                onDragOver={isDropTarget ? (e) => onDragOver(e, col) : undefined}
                onDrop={isDropTarget ? (e) => onDrop(e, col) : undefined}
                onDragLeave={() => setDragOverCol(null)}
              >
                <div className="mb-2 flex items-center gap-1">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {t[STATUS_LABEL_KEY[col]]}
                  </span>
                  <span className="ml-auto rounded-full bg-muted px-1.5 text-xs">{colApplicants.length}</span>
                </div>
                <div className="space-y-2">
                  {colApplicants.map((a) => (
                    <ApplicantCard
                      key={a.applicationId}
                      applicant={a}
                      locale={locale}
                      t={t}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onNoteOpen={openNoteDialog}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Mobile list / list view */}
      {(view === 'kanban' || view === 'list') && (
        <div className={view === 'kanban' ? 'md:hidden' : ''} aria-label="applicants-list">
          {/* Sort controls for list view */}
          {view === 'list' && (
            <div className="mb-3 flex flex-wrap gap-2">
              <Button
                variant={sortKey === 'completeness' ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setSortKey('completeness'); setListPage(0) }}
              >
                {t.sortByCompleteness}
              </Button>
              <Button
                variant={sortKey === 'cgpa' ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setSortKey('cgpa'); setListPage(0) }}
              >
                {t.sortByCgpa}
              </Button>
              <Button
                variant={sortKey === 'graduationYear' ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setSortKey('graduationYear'); setListPage(0) }}
              >
                {t.sortByGradYear}
              </Button>
            </div>
          )}
          <div className="space-y-2">
            {(view === 'list' ? listRows : sortedApplicants).map((a) => (
              <ApplicantCard
                key={a.applicationId}
                applicant={a}
                locale={locale}
                t={t}
                onNoteOpen={openNoteDialog}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
          {view === 'list' && totalPages > 1 && (
            <div className="mt-4 flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={listPage === 0}
                onClick={() => setListPage((p) => Math.max(0, p - 1))}
              >
                ←
              </Button>
              <span className="flex items-center px-2 text-sm">
                {listPage + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={listPage >= totalPages - 1}
                onClick={() => setListPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                →
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Note dialog */}
      {noteDialog && (
        <Dialog open={noteDialog.open} onOpenChange={(o) => !o && setNoteDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t.noteLabel}</DialogTitle>
            </DialogHeader>
            <textarea
              value={noteValue}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNoteValue(e.target.value)}
              placeholder={t.notePlaceholder}
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              maxLength={2000}
            />
            {noteError && <p className="text-sm text-destructive">{noteError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setNoteDialog(null)} disabled={isPending}>
                {t.noteCancel}
              </Button>
              <Button onClick={handleNoteSave} disabled={isPending}>
                {isPending ? t.noteSaving : t.noteSave}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function ApplicantCard({
  applicant: a,
  locale,
  t,
  onDragStart,
  onDragEnd,
  onNoteOpen,
  onStatusChange,
}: {
  applicant: ApplicantRow
  locale: string
  t: Props['t']
  onDragStart?: (id: string) => void
  onDragEnd?: () => void
  onNoteOpen: (id: string, current: string | null) => void
  onStatusChange?: (id: string, status: ApplicationStatus) => void
}) {
  return (
    <div
      className="rounded-md border bg-card p-2 shadow-sm"
      draggable={onDragStart !== undefined}
      onDragStart={onDragStart ? () => onDragStart(a.applicationId) : undefined}
      onDragEnd={onDragEnd}
    >
      <div className="text-sm font-medium">
        {a.card.unlocked ? a.card.name : (
          <span className="text-muted-foreground">{a.card.name}</span>
        )}
      </div>
      {a.card.school && (
        <div className="text-xs text-muted-foreground">
          {locale === 'zh' ? a.card.school.nameZh : a.card.school.nameEn}
        </div>
      )}
      {a.card.cgpa && (
        <div className="text-xs text-muted-foreground">CGPA {a.card.cgpa}</div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className="rounded-full bg-muted px-1.5 text-xs">{t[STATUS_LABEL_KEY[a.status]]}</span>
        <span className="text-xs text-muted-foreground">{a.card.completeness}%</span>
      </div>
      {/* Status change select (list view) */}
      {onStatusChange && a.status !== ApplicationStatus.WITHDRAWN && (
        <select
          className="mt-1 w-full rounded border text-xs"
          value={a.status}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onStatusChange(a.applicationId, e.target.value as ApplicationStatus)}
          aria-label={t.changeStatusLabel}
        >
          {COMPANY_SETTABLE.map((s) => (
            <option key={s} value={s}>
              {t[STATUS_LABEL_KEY[s]]}
            </option>
          ))}
        </select>
      )}
      <div className="mt-1 flex gap-1">
        <button
          className="text-xs text-primary underline"
          onClick={() => onNoteOpen(a.applicationId, a.companyNote)}
        >
          {t.noteLabel}
          {a.companyNote ? ' ✏' : ' +'}
        </button>
      </div>
    </div>
  )
}
