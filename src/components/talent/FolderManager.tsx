'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import {
  createFolderAction,
  renameFolderAction,
  deleteFolderAction,
} from '@/server/actions/folders'
import type { FolderSummary } from '@/server/services/talent-folders'

interface Props {
  initialFolders: FolderSummary[]
  locale: string
  labels: {
    createFolder: string
    folderNamePlaceholder: string
    create: string
    rename: string
    delete: string
    cancel: string
    confirm: string
    deleteConfirm: string
    items: string
    noFolders: string
    viewFolder: string
  }
}

export function FolderManager({ initialFolders, locale, labels }: Props) {
  const [folders, setFolders] = useState<FolderSummary[]>(initialFolders)
  const [newName, setNewName] = useState('')
  const [renameTarget, setRenameTarget] = useState<FolderSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<FolderSummary | null>(null)
  const [isPending, startTransition] = useTransition()

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

  function openRename(folder: FolderSummary) {
    setRenameTarget(folder)
    setRenameValue(folder.name)
  }

  function handleRename() {
    if (!renameTarget || !renameValue.trim()) return
    const id = renameTarget.id
    const name = renameValue.trim()
    startTransition(async () => {
      const res = await renameFolderAction({ id, name })
      if (res.ok) {
        setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)))
        setRenameTarget(null)
      }
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    startTransition(async () => {
      const res = await deleteFolderAction({ id })
      if (res.ok) {
        setFolders((prev) => prev.filter((f) => f.id !== id))
        setDeleteTarget(null)
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <div className="flex gap-2">
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
        <Button onClick={handleCreate} disabled={isPending || !newName.trim()}>
          {labels.createFolder}
        </Button>
      </div>

      {/* Folder list */}
      {folders.length === 0 ? (
        <div className="rounded-card border p-8 text-center text-muted-foreground">
          {labels.noFolders}
        </div>
      ) : (
        <ul className="space-y-3">
          {folders.map((folder) => (
            <li
              key={folder.id}
              className="flex items-center justify-between rounded-card border bg-card px-4 py-3"
            >
              <div>
                <Link
                  href={`/${locale}/e/folders/${folder.id}`}
                  className="font-medium hover:text-primary"
                  prefetch={false}
                >
                  {folder.name}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {folder.itemCount} {labels.items}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openRename(folder)}
                  aria-label={`${labels.rename} ${folder.name}`}
                >
                  {labels.rename}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDeleteTarget(folder)}
                  aria-label={`${labels.delete} ${folder.name}`}
                >
                  {labels.delete}
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/${locale}/e/folders/${folder.id}`} prefetch={false}>
                    {labels.viewFolder}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Rename dialog */}
      <Dialog open={renameTarget !== null} onOpenChange={(o) => { if (!o) setRenameTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.rename}</DialogTitle>
            <DialogDescription>{''}</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder={labels.folderNamePlaceholder}
            maxLength={100}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
            }}
            aria-label={labels.folderNamePlaceholder}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending}>{labels.cancel}</Button>
            </DialogClose>
            <Button onClick={handleRename} disabled={isPending || !renameValue.trim()}>
              {labels.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.delete}</DialogTitle>
            <DialogDescription>{labels.deleteConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending}>{labels.cancel}</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {labels.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
