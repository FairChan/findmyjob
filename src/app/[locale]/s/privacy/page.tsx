import { headers } from 'next/headers'
import { getTranslations, getLocale } from 'next-intl/server'
import { requireStudent } from '@/server/authz'
import {
  getLatestTalentPoolConsent,
  listBlockedCompanies,
  getProfileViews,
  getUnlocks,
} from '@/server/services/privacy'
import PrivacyCenter from '@/components/privacy/PrivacyCenter'
import { formatKLDate } from '@/lib/format-date'
import { getStudentMatchingUiState } from '@/server/services/semantic-matching'
import { StudentMatchingPanel } from '@/components/matching/StudentMatchingPanel'
import { getMarketingUiState } from '@/server/services/marketing-consent'
import { MarketingPreferences } from '@/components/privacy/MarketingPreferences'

export default async function PrivacyPage() {
  const t = await getTranslations('privacy')
  const locale = await getLocale()
  const { userId } = await requireStudent(await headers())
  const matchingState = await getStudentMatchingUiState({ userId })
  const marketing = await getMarketingUiState({ userId })
  const marketingState = { available: marketing.available, consentGranted: marketing.consentGranted, legalVersion: marketing.legalVersion }

  const [consentGranted, blocked, views, unlocks] = await Promise.all([
    getLatestTalentPoolConsent(userId),
    listBlockedCompanies({ userId }),
    getProfileViews({ userId }),
    getUnlocks({ userId }),
  ])

  const formattedViews = views.map((v) => ({
    companyId: v.companyId,
    companyName: v.companyName,
    viewedAt: formatKLDate(v.viewedAt, locale),
    viewedAtKey: v.viewedAt.toISOString(),
  }))

  const formattedUnlocks = unlocks.map((u) => ({
    companyId: u.companyId,
    companyName: u.companyName,
    unlockedAt: formatKLDate(u.unlockedAt, locale),
    unlockedAtKey: u.unlockedAt.toISOString(),
    source: u.source,
  }))

  return (
    <main id="main-content" className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">{t('title')}</h1>
      <p className="mb-8 text-sm text-muted-foreground">{t('subtitle')}</p>
      <StudentMatchingPanel locale={locale} uiState={matchingState} consentOnly />
      <MarketingPreferences locale={locale} audience="student" uiState={marketingState} />
      <PrivacyCenter
        initialVisible={consentGranted === true}
        initialBlocked={blocked}
        profileViews={formattedViews}
        unlocks={formattedUnlocks}
        locale={locale}
      />
    </main>
  )
}
