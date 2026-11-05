import { getTranslations } from 'next-intl/server'

export default async function AdminDashboardPage() {
  const t = await getTranslations('adminDashboard')

  return (
    <div className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
    </div>
  )
}
