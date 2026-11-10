import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import { getProfileForOnboarding } from '@/server/services/student-profile'
import { db } from '@/server/db'
import OnboardingWizard from '@/components/onboarding/OnboardingWizard'

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
  if (profile.onboardingStep >= 5) {
    redirect(`/${locale}/s`)
  }

  const schools = await db.school.findMany({
    where: { active: true },
    select: { id: true, nameZh: true, nameEn: true },
    orderBy: [{ isPartner: 'desc' }, { nameZh: 'asc' }],
  })

  const currentStep = Math.min(Math.max(profile.onboardingStep, 1), 4)

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
      />
    </div>
  )
}
