'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { removeFromFolderAction, updateNoteAction } from '@/server/actions/folders'

interface Props {
  folderId: string
  studentId: string
  initialNote: string | null
  onRemoved: () => void
  labels: {
    editNote: string
    remove: string
    cancel: string
    save: string
    deleteConfirm: string
    confirm: string
    notePlaceholder: string
  }
}

export function FolderItemActions({
  folderId,
  studentId,
  initialNote,
  onRemoved,
  labels,
}: Props) {
  const router = useRouter()
  const [noteOpen, setNoteOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [noteValue, setNoteValue] = useState(initialNote ?? '')
  const [isPending, startTransition] = useTransition()

  function handleSaveNote() {
    startTransition(async () => {
      const res = await updateNoteAction({ folderId, studentId, note: noteValue || null })
      if (res.ok) setNoteOpen(false)
    })
  }

  function handleRemove() {
    startTransition(async () => {
      const res = await removeFromFolderAction({ folderId, studentId })
      if (res.ok) {
        setDeleteOpen(false)
        onRemoved()
        router.refresh()
      }
    })
  }

  return (
    <>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)}>
          {labels.editNote}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDeleteOpen(true)}
          aria-label={labels.remove}
        >
          {labels.remove}
        </Button>
      </div>

      {/* Note edit dialog */}
      <Dialog open={noteOpen} onOpenChange={(o) => { if (!o) setNoteOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.editNote}</DialogTitle>
            <DialogDescription>{''}</DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            placeholder={labels.notePlaceholder}
            maxLength={500}
            aria-label={labels.editNote}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending}>{labels.cancel}</Button>
            </DialogClose>
            <Button onClick={handleSaveNote} disabled={isPending}>
              {labels.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={(o) => { if (!o) setDeleteOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.remove}</DialogTitle>
            <DialogDescription>{labels.deleteConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending}>{labels.cancel}</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleRemove} disabled={isPending}>
              {labels.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
