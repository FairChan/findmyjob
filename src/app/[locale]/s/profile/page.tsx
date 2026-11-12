import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { getProfileForOnboarding } from '@/server/services/student-profile'
import { db } from '@/server/db'
import ProfileEditor from '@/components/profile/ProfileEditor'
import { WorkspacePage } from '@/components/layout/workspace-page'
import ProfileOverview from '@/components/profile/profile-overview'

interface Props {
  params: Promise<{ locale: string }>
}

export default async function StudentProfilePage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('profile')

  const { userId } = await requireStudent(await headers())
  const profile = await getProfileForOnboarding({ userId })

  const schools = await db.school.findMany({
    where: { active: true },
    select: { id: true, nameZh: true, nameEn: true },
    orderBy: [{ isPartner: 'desc' }, { nameZh: 'asc' }],
  })

  return (
    <WorkspacePage title={t('title')}>
      <ProfileEditor locale={locale} profile={profile} schools={schools} />
      <ProfileOverview params={params} />
    </WorkspacePage>
  )
}
