import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { getProfileForOnboarding } from '@/server/services/student-profile'
import { db } from '@/server/db'
import OnboardingWizard from '@/components/onboarding/OnboardingWizard'
import { getOwnContact } from '@/server/services/contact-access'

interface Props {
  params: Promise<{ locale: string }>
}

export default async function StudentOnboardingPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('onboarding')

  const { userId } = await requireStudent(await headers())
  const profile = await getProfileForOnboarding({ userId })

  // If profile doesn't exist or onboarding is already complete, redirect
  if (!profile) {
    redirect(`/${locale}/s`)
  }
  const [contact, resumes] = await Promise.all([
    getOwnContact({ userId }),
    db.resumeFile.findMany({
      where: { studentId: profile.id },
      select: { id: true, fileName: true, sizeBytes: true, pageCount: true, isPrimary: true, createdAt: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    }),
  ])

  if (profile.onboardingStep >= 6 && Object.values(contact).some(Boolean) && resumes.length > 0) {
    redirect(`/${locale}/s`)
  }

  const schools = await db.school.findMany({
    where: { active: true },
    select: { id: true, nameZh: true, nameEn: true },
    orderBy: [{ isPartner: 'desc' }, { nameZh: 'asc' }],
  })

  const currentStep = Math.min(Math.max(profile.onboardingStep, 1), 5)

  return (
    <div>
      <div className="sr-only">
        <h1>{t('title')}</h1>
      </div>
      <OnboardingWizard
        locale={locale}
        initialStep={currentStep}
        profile={profile}
        schools={schools}
        contact={contact}
        resumes={resumes}
      />
    </div>
  )
}
