'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { submitVerificationAction } from '@/server/actions/verification'

interface UploadedFile {
  key: string
  name: string
}

const UPLOAD_ERROR_MAP: Record<string, string> = {
  FILE_TOO_LARGE: 'uploadErrorSize',
  INVALID_FILE_TYPE: 'uploadErrorType',
  RATE_LIMITED: 'uploadErrorRateLimit',
}

function uploadErrorKey(code: string | undefined): string {
  return UPLOAD_ERROR_MAP[code ?? ''] ?? 'uploadError'
}

export function VerificationForm({ locale }: { locale: string }) {
  const t = useTranslations('companyVerification')
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [note, setNote] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const canAddMore = files.length < 5

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (!selected.length) return
    e.target.value = ''

    // Only allow up to 5 total
    const toUpload = selected.slice(0, 5 - files.length)
    if (!toUpload.length) return

    setUploadError(null)
    setUploading(true)

    const newFiles: UploadedFile[] = []
    for (const file of toUpload) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/uploads/VERIFICATION', {
          method: 'POST',
          body: formData,
        })
        const json = (await res.json()) as { ok: boolean; key?: string; code?: string }
        if (!json.ok) {
          setUploadError(t(uploadErrorKey(json.code) as keyof typeof t))
          break
        }
        newFiles.push({ key: json.key!, name: file.name })
      } catch {
        setUploadError(t('uploadError'))
        break
      }
    }

    if (newFiles.length > 0) {
      setFiles(prev => [...prev, ...newFiles])
    }
    setUploading(false)
  }

  function removeFile(key: string) {
    setFiles(prev => prev.filter(f => f.key !== key))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (files.length === 0) {
      setSubmitError(t('errorMinFiles'))
      return
    }
    setSubmitError(null)

    startTransition(async () => {
      const result = await submitVerificationAction({
        documentKeys: files.map(f => f.key),
        note: note.trim() || undefined,
      })

      if (!result.ok) {
        const codeMap: Record<string, string> = {
          FORBIDDEN: 'errorForbidden',
          VALIDATION_ERROR: 'errorAlreadyPending',
        }
        // Inspect the specific validation error from the service
        const key = codeMap[result.code] ?? 'errorFailed'
        setSubmitError(t(key as keyof typeof t))
        return
      }

      setSuccess(true)
      router.refresh()
    })
  }

  if (success) {
    return (
      <div className="rounded-card border border-success/30 bg-success-muted p-6 text-center">
        <p className="font-medium text-success">{t('successMessage')}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* File list */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t('filesLabel')}</label>
        <p className="mb-3 text-xs text-muted-foreground">{t('filesHint')}</p>

        {files.length > 0 && (
          <ul className="mb-3 divide-y rounded-card border" aria-label={t('filesLabel')}>
            {files.map(f => (
              <li key={f.key} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0 truncate text-sm">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(f.key)}
                  className="shrink-0 text-xs text-destructive hover:underline"
                >
                  {t('removeFile')}
                </button>
              </li>
            ))}
          </ul>
        )}

        {files.length > 0 && (
          <p className="mb-2 text-xs text-muted-foreground">
            {t('fileCount', { count: files.length })}
          </p>
        )}

        {uploadError && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {uploadError}
          </p>
        )}

        {canAddMore && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              multiple
              className="absolute w-0 h-0 overflow-hidden opacity-0"
              onChange={handleFileChange}
              aria-label={t('addFile')}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? t('uploading') : t('addFile')}
            </Button>
          </>
        )}
      </div>

      {/* Note */}
      <div>
        <label htmlFor="verification-note" className="mb-1 block text-sm font-medium">
          {t('noteLabel')}
        </label>
        <textarea
          id="verification-note"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          maxLength={500}
          rows={3}
          className="w-full rounded-control border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}

      <Button
        type="submit"
        disabled={isPending || uploading || files.length === 0}
        className="min-h-[44px] w-full sm:w-auto"
      >
        {isPending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
