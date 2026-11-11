'use client'
import { useState, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ApplicationStatus } from '@prisma/client'
import type { ApplicantRow } from '@/server/services/applicants'
import type { ActionResult } from '@/server/action'
import { sortApplicantRows } from '@/lib/applicants-sort'
import type { SortKey } from '@/lib/applicants-sort'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

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
    colName: string
    colSchool: string
    colMajor: string
    colDegree: string
    colGradYearMonth: string
    colCGPA: string
    colWorkAuth: string
    colLanguages: string
    colInternships: string
    colCampus: string
    colCompleteness: string
    colActions: string
    statusChangeError: string
  }
  changeStatusAction: (input: { applicationId: string; toStatus: ApplicationStatus; note?: string | null }) => Promise<ActionResult<void>>
  updateNoteAction: (input: { applicationId: string; note: string | null }) => Promise<ActionResult<void>>
  markViewedAction: (input: { applicationId: string }) => Promise<ActionResult<void>>
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

export default function ApplicantsBoard({ applicants: initialApplicants, locale, t, changeStatusAction, updateNoteAction, markViewedAction }: Props) {
  const router = useRouter()
  const [applicants, setApplicants] = useState(initialApplicants)
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [sortKey, setSortKey] = useState<SortKey>('completeness')
  const [isPending, startTransition] = useTransition()

  // Note dialog state
  const [noteDialog, setNoteDialog] = useState<{ open: boolean; applicationId: string; current: string } | null>(null)
  const [noteValue, setNoteValue] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)

  // Status change error
  const [statusChangeError, setStatusChangeError] = useState<string | null>(null)

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<ApplicationStatus | null>(null)

  const handleStatusChange = useCallback(
    (applicationId: string, toStatus: ApplicationStatus) => {
      setStatusChangeError(null)
      startTransition(async () => {
        const res = await changeStatusAction({ applicationId, toStatus })
        if (res.ok) {
          setApplicants((prev) =>
            prev.map((a) => (a.applicationId === applicationId ? { ...a, status: toStatus } : a)),
          )
        } else {
          setStatusChangeError(res.code === 'FORBIDDEN' ? t.errorForbidden : t.statusChangeError)
        }
      })
    },
    [changeStatusAction, t.errorForbidden, t.statusChangeError],
  )

  const handleViewProfile = useCallback(
    (applicationId: string, studentId: string) => {
      markViewedAction({ applicationId }).catch(() => {})
      router.push(`/${locale}/e/talent/${studentId}`)
    },
    [markViewedAction, router, locale],
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

  // ---- List view sort (uses pure sortApplicantRows) ----
  const sortedApplicants = sortApplicantRows(applicants, sortKey)

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

      {/* Status change error banner */}
      {statusChangeError && (
        <div role="alert" className="mb-3 rounded-control border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {statusChangeError}
        </div>
      )}

      {/* Kanban view */}
      {view === 'kanban' && (
        <div className="hidden gap-3 md:flex" aria-label="applicants-kanban">
          {KANBAN_COLS.map((col) => {
            const colApplicants = applicants.filter((a) => a.status === col)
            const isDropTarget = COMPANY_SETTABLE.includes(col)
            return (
              <div
                key={col}
                className={`min-w-[160px] flex-1 rounded-card border p-2 ${dragOverCol === col ? 'bg-muted/60' : 'bg-muted/20'}`}
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
                      onViewProfile={handleViewProfile}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Mobile kanban fallback (cards) */}
      {view === 'kanban' && (
        <div className="md:hidden" aria-label="applicants-list-mobile">
          <div className="space-y-2">
            {applicants.map((a) => (
              <ApplicantCard
                key={a.applicationId}
                applicant={a}
                locale={locale}
                t={t}
                onNoteOpen={openNoteDialog}
                onStatusChange={handleStatusChange}
                onViewProfile={handleViewProfile}
              />
            ))}
          </div>
        </div>
      )}

      {/* Standardized list view — compact table */}
      {view === 'list' && (
        <div aria-label="applicants-list">
          {/* Sort controls */}
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

          {/* Horizontally scrollable table */}
          <div className="overflow-x-auto rounded-control border">
            <table className="min-w-[900px] w-full text-sm" aria-label="standardized-applicant-list">
              <thead>
                <tr className="border-b bg-muted/40 text-xs font-semibold text-muted-foreground">
                  <th className="px-3 py-2 text-left">{t.colName}</th>
                  <th className="px-3 py-2 text-left">{t.colSchool}</th>
                  <th className="px-3 py-2 text-left">{t.colMajor}</th>
                  <th className="px-3 py-2 text-left">{t.colDegree}</th>
                  <th className="px-3 py-2 text-left">{t.colGradYearMonth}</th>
                  <th className="px-3 py-2 text-left">{t.colCGPA}</th>
                  <th className="px-3 py-2 text-left">{t.colWorkAuth}</th>
                  <th className="px-3 py-2 text-left">{t.colLanguages}</th>
                  <th className="px-3 py-2 text-center">{t.colInternships}</th>
                  <th className="px-3 py-2 text-center">{t.colCampus}</th>
                  <th className="px-3 py-2 text-center">{t.colCompleteness}</th>
                  <th className="px-3 py-2 text-left">{t.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((a) => (
                  <ApplicantTableRow
                    key={a.applicationId}
                    applicant={a}
                    locale={locale}
                    t={t}
                    onNoteOpen={openNoteDialog}
                    onStatusChange={handleStatusChange}
                    onViewProfile={handleViewProfile}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
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
              className="min-h-[120px] w-full rounded-control border border-input bg-background px-3 py-2 text-sm"
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

// ---- Kanban card (unchanged from M5-T05, plus viewProfile) ----

function ApplicantCard({
  applicant: a,
  locale,
  t,
  onDragStart,
  onDragEnd,
  onNoteOpen,
  onStatusChange,
  onViewProfile,
}: {
  applicant: ApplicantRow
  locale: string
  t: Props['t']
  onDragStart?: (id: string) => void
  onDragEnd?: () => void
  onNoteOpen: (id: string, current: string | null) => void
  onStatusChange?: (id: string, status: ApplicationStatus) => void
  onViewProfile: (applicationId: string, studentId: string) => void
}) {
  return (
    <div
      className="rounded-control border bg-card p-2 shadow-sm"
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
      {/* Status change select */}
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
      <div className="mt-1 flex gap-2">
        <button
          className="text-xs text-primary underline"
          onClick={() => onNoteOpen(a.applicationId, a.companyNote)}
        >
          {t.noteLabel}
          {a.companyNote ? ' ✏' : ' +'}
        </button>
        <button
          className="text-xs text-primary underline"
          onClick={() => onViewProfile(a.applicationId, a.studentId)}
        >
          {t.viewProfile}
        </button>
      </div>
    </div>
  )
}

// ---- Table row for standardized list view ----

function ApplicantTableRow({
  applicant: a,
  locale,
  t,
  onNoteOpen,
  onStatusChange,
  onViewProfile,
}: {
  applicant: ApplicantRow
  locale: string
  t: Props['t']
  onNoteOpen: (id: string, current: string | null) => void
  onStatusChange: (id: string, status: ApplicationStatus) => void
  onViewProfile: (applicationId: string, studentId: string) => void
}) {
  const gradDisplay =
    a.card.graduationYear !== null
      ? a.graduationMonth !== null
        ? `${a.card.graduationYear}-${String(a.graduationMonth).padStart(2, '0')}`
        : String(a.card.graduationYear)
      : '—'

  const schoolName = a.card.school
    ? locale === 'zh'
      ? a.card.school.nameZh
      : a.card.school.nameEn
    : '—'

  return (
    <tr className="border-b last:border-0 hover:bg-muted/20">
      <td className="px-3 py-2 font-medium">
        {a.card.unlocked ? (
          a.card.name
        ) : (
          <span className="text-muted-foreground">{a.card.name}</span>
        )}
      </td>
      <td className="px-3 py-2 text-muted-foreground">{schoolName}</td>
      <td className="px-3 py-2 text-muted-foreground">{a.card.major ?? '—'}</td>
      <td className="px-3 py-2 text-muted-foreground">{a.card.degreeLevel ?? '—'}</td>
      <td className="px-3 py-2 text-muted-foreground">{gradDisplay}</td>
      <td className="px-3 py-2 text-muted-foreground">{a.card.cgpa ?? '—'}</td>
      <td className="px-3 py-2 text-muted-foreground">{a.card.workAuth ?? '—'}</td>
      <td className="px-3 py-2 text-muted-foreground">{a.languages.length > 0 ? a.languages.join(', ') : '—'}</td>
      <td className="px-3 py-2 text-center text-muted-foreground">{a.internshipCount}</td>
      <td className="px-3 py-2 text-center text-muted-foreground">{a.campusCount}</td>
      <td className="px-3 py-2 text-center text-muted-foreground">{a.card.completeness}%</td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          {a.status !== ApplicationStatus.WITHDRAWN && (
            <select
              className="rounded border text-xs"
              value={a.status}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                onStatusChange(a.applicationId, e.target.value as ApplicationStatus)
              }
              aria-label={t.changeStatusLabel}
            >
              {COMPANY_SETTABLE.map((s) => (
                <option key={s} value={s}>
                  {t[STATUS_LABEL_KEY[s]]}
                </option>
              ))}
            </select>
          )}
          <button
            className="min-h-[24px] min-w-[24px] text-xs text-primary underline"
            onClick={() => onViewProfile(a.applicationId, a.studentId)}
          >
            {t.viewProfile}
          </button>
          <button
            className="text-xs text-muted-foreground underline"
            onClick={() => onNoteOpen(a.applicationId, a.companyNote)}
          >
            {t.noteLabel}
            {a.companyNote ? ' ✏' : ' +'}
          </button>
        </div>
      </td>
    </tr>
  )
}
