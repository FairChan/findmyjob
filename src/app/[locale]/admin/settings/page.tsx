import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireAdmin } from '@/server/authz'
import { getAllSettings } from '@/server/services/admin-settings'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const ctx = await requireAdmin(await headers())
  const t = await getTranslations('adminSettings')
  const settings = await getAllSettings(ctx)

  return (
    <main id="main-content" className="p-6 max-w-5xl mx-auto">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
      <SettingsForm settings={settings} />
    </main>
  )
}
