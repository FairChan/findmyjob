import { getTranslations } from 'next-intl/server'

export default async function StudentOnboardingPage() {
  const t = await getTranslations('onboarding')

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
    </div>
  )
}
