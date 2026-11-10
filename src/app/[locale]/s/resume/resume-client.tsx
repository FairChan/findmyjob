'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { setPrimaryResume, deleteResume } from '@/server/actions/resume'

interface ResumeFile {
  id: string
  fileName: string
  sizeBytes: number
  pageCount: number | null
  isPrimary: boolean
  createdAt: Date
}

interface Props {
  resumes: ResumeFile[]
  locale: string
}

const ERROR_KEY_MAP: Record<string, 'errorFileTooLarge' | 'errorInvalidType' | 'errorEncryptedPdf' | 'errorTooManyPages' | 'errorRateLimit' | 'errorUploadFailed'> = {
  FILE_TOO_LARGE: 'errorFileTooLarge',
  INVALID_FILE_TYPE: 'errorInvalidType',
  ENCRYPTED_PDF: 'errorEncryptedPdf',
  TOO_MANY_PAGES: 'errorTooManyPages',
  RATE_LIMITED: 'errorRateLimit',
}

function errorKey(code: string | undefined) {
  return ERROR_KEY_MAP[code ?? ''] ?? 'errorUploadFailed'
}

export function ResumeManager({ resumes, locale }: Props) {
  const t = useTranslations('resume')
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so the same file can be re-selected after an error
    e.target.value = ''
    setUploadError(null)
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/uploads/RESUME', {
        method: 'POST',
        body: formData,
      })
      const json = (await res.json()) as { ok: boolean; code?: string }
      if (!json.ok) {
        setUploadError(t(errorKey(json.code)))
      } else {
        router.refresh()
      }
    } catch {
      setUploadError(t('errorUploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const handleSetPrimary = (resumeId: string) => {
    startTransition(async () => {
      const result = await setPrimaryResume({ resumeId })
      if (result.ok) router.refresh()
    })
  }

  const handleDelete = (resumeId: string) => {
    if (!confirm(t('deleteConfirm'))) return
    startTransition(async () => {
      const result = await deleteResume({ resumeId })
      if (result.ok) router.refresh()
    })
  }

  const dateFormatter = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-Hans-MY' : 'en-MY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  })

  return (
    <div className="space-y-6">
      {/* Upload area */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="absolute w-0 h-0 overflow-hidden opacity-0"
          onChange={handleUpload}
          aria-label={t('uploadButton')}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex min-h-[44px] min-w-[120px] items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? t('uploading') : t('uploadButton')}
        </button>
        <p className="mt-1 text-xs text-muted-foreground">{t('uploadHint')}</p>
        {uploadError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {uploadError}
          </p>
        )}
      </div>

      {/* Resume list */}
      {resumes.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label={t('title')}>
          {resumes.map(resume => (
            <li key={resume.id} className="flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{resume.fileName}</span>
                  {resume.isPrimary && (
                    <span className="rounded bg-brand/10 px-1.5 py-0.5 text-xs font-medium text-brand">
                      {t('primary')}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {resume.pageCount != null && (
                    <span className="mr-3">{t('pages', { count: resume.pageCount })}</span>
                  )}
                  <span>
                    {t('uploadedAt', {
                      date: dateFormatter.format(new Date(resume.createdAt)),
                    })}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <a
                  href={`/api/resumes/${resume.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] min-w-[60px] items-center justify-center rounded border px-3 py-1 text-sm transition hover:bg-muted"
                >
                  {t('preview')}
                </a>
                {!resume.isPrimary && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleSetPrimary(resume.id)}
                    className="inline-flex min-h-[36px] items-center justify-center rounded border px-3 py-1 text-sm transition hover:bg-muted disabled:opacity-60"
                  >
                    {t('setPrimary')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleDelete(resume.id)}
                  className="inline-flex min-h-[36px] items-center justify-center rounded border border-red-200 px-3 py-1 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                >
                  {t('delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Privacy notice */}
      <p className="text-xs text-muted-foreground">{t('privacy')}</p>
    </div>
  )
}
