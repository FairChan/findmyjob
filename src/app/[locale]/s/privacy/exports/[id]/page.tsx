import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { requireStudent } from '@/server/authz'
import { getExportDownloadRequest } from '@/server/services/data-rights'
import { getSignedDownloadUrl } from '@/lib/storage'
import { ExportDownloadButton } from '@/components/privacy/export-download-button'
import { WorkspacePage } from '@/components/layout/workspace-page'
import { Card } from '@/components/ui/card'

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
    <WorkspacePage title={t('title')}>
      {pending ? (
        <Card>
          <p className="text-body text-muted-foreground">{t('pending')}</p>
        </Card>
      ) : signedUrl ? (
        <Card className="space-y-5">
          <p className="text-body text-muted-foreground">{t('description')}</p>
          <ExportDownloadButton url={signedUrl} label={t('downloadButton')} />
          <p className="text-sm text-muted-foreground">{t('urlExpiry')}</p>
        </Card>
      ) : null}
    </WorkspacePage>
  )
}
