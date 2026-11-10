import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireStudent } from '@/server/authz'
import { getExportDownloadRequest } from '@/server/services/data-rights'
import { getSignedDownloadUrl } from '@/lib/storage'
import { ExportDownloadButton } from '@/components/privacy/export-download-button'

const idSchema = z.string().cuid()

export const dynamic = 'force-dynamic'

export default async function ExportDownloadPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { id } = await params
  const parsed = idSchema.safeParse(id)
  if (!parsed.success) return notFound()

  const { userId } = await requireStudent(await headers())

  let signedUrl: string | null = null
  let notFound404 = false
  let pending = false

  try {
    const req = await getExportDownloadRequest({ userId }, parsed.data)
    if (!req) {
      pending = true
    } else {
      signedUrl = await getSignedDownloadUrl(req.resultKey!, `findmyjob-export-${req.id}.zip`)
    }
  } catch {
    notFound404 = true
  }

  if (notFound404) return notFound()

  const t = await getTranslations('exportDownload')

  return (
    <div
      className="container mx-auto max-w-xl px-4 py-10"
    >
      <h1 className="mb-4 text-2xl font-bold">{t('title')}</h1>
      {pending ? (
        <p className="text-muted-foreground">{t('pending')}</p>
      ) : signedUrl ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('description')}</p>
          <ExportDownloadButton url={signedUrl} label={t('downloadButton')} />
          <p className="text-xs text-muted-foreground">{t('urlExpiry')}</p>
        </div>
      ) : null}
    </div>
  )
}
