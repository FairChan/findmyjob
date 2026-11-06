'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  listFoldersAction,
  getStudentFolderIdsAction,
  addToFolderAction,
  removeFromFolderAction,
  createFolderAction,
} from '@/server/actions/folders'
import type { FolderSummary } from '@/server/services/talent-folders'

interface Props {
  studentId: string
  labels: {
    save: string
    saveToFolder: string
    noFolders: string
    createNew: string
    folderNamePlaceholder: string
    create: string
    added: string
    remove: string
    close: string
    loading: string
    errorOccurred: string
  }
}

export function SaveToFolderButton({ studentId, labels }: Props) {
  const [open, setOpen] = useState(false)
  const [folders, setFolders] = useState<FolderSummary[]>([])
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleOpen() {
    setOpen(true)
    setLoadError(false)
    startTransition(async () => {
      const [foldersRes, memberRes] = await Promise.all([
        listFoldersAction(),
        getStudentFolderIdsAction({ studentId }),
      ])
      if (!foldersRes.ok || !memberRes.ok) {
        setLoadError(true)
        return
      }
      setFolders(foldersRes.data)
      setMemberIds(memberRes.data.folderIds)
    })
  }

  function handleToggle(folderId: string) {
    const inFolder = memberIds.includes(folderId)
    startTransition(async () => {
      if (inFolder) {
        const res = await removeFromFolderAction({ folderId, studentId })
        if (res.ok) setMemberIds((ids) => ids.filter((id) => id !== folderId))
      } else {
        const res = await addToFolderAction({ folderId, studentId })
        if (res.ok) setMemberIds((ids) => [...ids, folderId])
      }
    })
  }

  function handleCreate() {
    if (!newName.trim()) return
    startTransition(async () => {
      const res = await createFolderAction({ name: newName.trim() })
      if (res.ok) {
        setFolders((prev) => [res.data, ...prev])
        setNewName('')
      }
    })
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={handleOpen} aria-haspopup="dialog">
        {labels.save}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.saveToFolder}</DialogTitle>
            <DialogDescription>{''}</DialogDescription>
          </DialogHeader>

          {isPending && folders.length === 0 ? (
            <p className="text-sm text-muted-foreground">{labels.loading}</p>
          ) : loadError ? (
            <p className="text-sm text-destructive">{labels.errorOccurred}</p>
          ) : (
            <div className="space-y-2">
              {folders.length === 0 ? (
                <p className="text-sm text-muted-foreground">{labels.noFolders}</p>
              ) : (
                <ul className="space-y-1">
                  {folders.map((folder) => {
                    const inFolder = memberIds.includes(folder.id)
                    return (
                      <li key={folder.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <span className="text-sm font-medium">
                          {folder.name}
                          {inFolder && (
                            <span className="ml-2 rounded-full bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
                              {labels.added}
                            </span>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant={inFolder ? 'outline' : 'default'}
                          disabled={isPending}
                          onClick={() => handleToggle(folder.id)}
                        >
                          {inFolder ? labels.remove : labels.save}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="flex gap-2 border-t pt-3">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={labels.folderNamePlaceholder}
                  maxLength={100}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                  }}
                  aria-label={labels.folderNamePlaceholder}
                />
                <Button size="sm" onClick={handleCreate} disabled={isPending || !newName.trim()}>
                  {labels.create}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
