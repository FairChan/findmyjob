import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { db } from '@/server/db'
import { listActiveSchools } from '@/server/services/school-verification'
import SchoolVerifyForm from '@/components/school-verify/SchoolVerifyForm'
import { WorkspacePage } from '@/components/layout/workspace-page'

interface Props {
  params: Promise<{ locale: string }>
}

export default async function SchoolVerifyPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('schoolVerify')
  const { userId } = await requireStudent(await headers())

  const [schools, profile] = await Promise.all([
    listActiveSchools(),
    db.studentProfile.findUnique({
      where: { userId },
      select: { schoolEmail: true, schoolVerifiedAt: true },
    }),
  ])

  const initiallyVerified = profile?.schoolVerifiedAt != null

  return (
    <WorkspacePage title={t('title')} lead={t('subtitle')}>
      <SchoolVerifyForm
        schools={schools}
        locale={locale}
        initiallyVerified={initiallyVerified}
        verifiedEmail={profile?.schoolEmail ?? null}
      />
    </WorkspacePage>
  )
}
