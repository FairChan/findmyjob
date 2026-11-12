'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { FileText } from 'lucide-react'
import { setPrimaryResume, deleteResume } from '@/server/actions/resume'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Row, RowList } from '@/components/ui/row-list'

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
  onBusyChange?: (busy: boolean) => void
  onRefresh?: () => Promise<void>
  disabled?: boolean
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

export function ResumeManager({ resumes, locale, onBusyChange, onRefresh, disabled = false }: Props) {
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
    onBusyChange?.(true)
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
        if (onRefresh) await onRefresh()
        else router.refresh()
      }
    } catch {
      setUploadError(t('errorUploadFailed'))
    } finally {
      setUploading(false)
      onBusyChange?.(false)
    }
  }

  const handleSetPrimary = (resumeId: string) => {
    onBusyChange?.(true)
    startTransition(async () => {
      try {
        const result = await setPrimaryResume({ resumeId })
        if (result.ok) {
          if (onRefresh) await onRefresh()
          else router.refresh()
        }
      } finally { onBusyChange?.(false) }
    })
  }

  const handleDelete = (resumeId: string) => {
    if (!confirm(t('deleteConfirm'))) return
    onBusyChange?.(true)
    startTransition(async () => {
      try {
        const result = await deleteResume({ resumeId })
        if (result.ok) {
          if (onRefresh) await onRefresh()
          else router.refresh()
        }
      } finally { onBusyChange?.(false) }
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
          disabled={disabled || uploading || pending}
          aria-label={t('uploadButton')}
        />
        <Button
          type="button"
          variant="brand"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading || pending}
          className="h-11 min-w-[7.5rem]"
        >
          {uploading ? t('uploading') : t('uploadButton')}
        </Button>
        <p className="mt-2 text-sm text-muted-foreground">{t('uploadHint')}</p>
        {uploadError && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {uploadError}
          </p>
        )}
      </div>

      {/* Resume list */}
      {resumes.length === 0 ? (
        <EmptyState title={t('empty')} icon={<FileText />} />
      ) : (
        <RowList aria-label={t('title')}>
          {resumes.map(resume => (
            <Row key={resume.id} className="flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{resume.fileName}</span>
                  {resume.isPrimary && <Badge tone="brand">{t('primary')}</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
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
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/resumes/${resume.id}`} target="_blank" rel="noopener noreferrer">
                    {t('preview')}
                  </a>
                </Button>
                {!resume.isPrimary && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || pending || uploading}
                    onClick={() => handleSetPrimary(resume.id)}
                  >
                    {t('setPrimary')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || pending || uploading}
                  onClick={() => handleDelete(resume.id)}
                  className="border-destructive/30 text-destructive hover:bg-destructive-muted hover:text-destructive"
                >
                  {t('delete')}
                </Button>
              </div>
            </Row>
          ))}
        </RowList>
      )}

      {/* Privacy notice */}
      <p className="text-sm text-muted-foreground">{t('privacy')}</p>
    </div>
  )
}
