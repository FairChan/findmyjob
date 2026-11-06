import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { getProfileForOnboarding } from '@/server/services/student-profile'
import { db } from '@/server/db'
import ProfileEditor from '@/components/profile/ProfileEditor'

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
    <main id="main-content" className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-8">{t('title')}</h1>
      <ProfileEditor locale={locale} profile={profile} schools={schools} />
    </main>
  )
}
