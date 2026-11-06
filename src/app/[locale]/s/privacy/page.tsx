import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import {
  getLatestTalentPoolConsent,
  listBlockedCompanies,
  getProfileViews,
  getUnlocks,
} from '@/server/services/privacy'
import PrivacyCenter from '@/components/privacy/PrivacyCenter'

export default async function PrivacyPage() {
  const t = await getTranslations('privacy')
  const { userId } = await requireStudent(await headers())

  const [consentGranted, blocked, views, unlocks] = await Promise.all([
    getLatestTalentPoolConsent(userId),
    listBlockedCompanies({ userId }),
    getProfileViews({ userId }),
    getUnlocks({ userId }),
  ])

  return (
    <main id="main-content" className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">{t('title')}</h1>
      <p className="mb-8 text-sm text-muted-foreground">{t('subtitle')}</p>
      <PrivacyCenter
        initialVisible={consentGranted === true}
        initialBlocked={blocked}
        profileViews={views}
        unlocks={unlocks}
      />
    </main>
  )
}
