import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { headers } from 'next/headers'
import { db } from '@/server/db'
import { ResumeManager } from './resume-client'
import type { Locale } from '@/i18n/routing'

interface Props {
  params: Promise<{ locale: Locale }>
}

export default async function ResumePage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('resume')

  const hdrs = await headers()
  const { userId } = await requireStudent(hdrs)

  const profile = await db.studentProfile.findUnique({
    where: { userId },
    select: {
      resumes: {
        select: {
          id: true,
          fileName: true,
          sizeBytes: true,
          pageCount: true,
          isPrimary: true,
          createdAt: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      },
    },
  })

  const resumes = profile?.resumes ?? []

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
      <ResumeManager resumes={resumes} locale={locale} />
    </div>
  )
}
