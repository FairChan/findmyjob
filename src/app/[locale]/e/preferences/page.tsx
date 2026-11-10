import { headers } from 'next/headers'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireEmployer } from '@/server/authz'
import { getMarketingUiState } from '@/server/services/marketing-consent'
import { MarketingPreferences } from '@/components/privacy/MarketingPreferences'

export default async function EmployerPreferencesPage() {
  const { userId } = await requireEmployer(await headers())
  const locale = await getLocale(), t = await getTranslations('marketing')
  const state = await getMarketingUiState({ userId })
  const uiState = { available: state.available, consentGranted: state.consentGranted, legalVersion: state.legalVersion }
  return <main id="main-content" className="container mx-auto max-w-2xl px-4 py-8">
    <h1 className="mb-2 text-2xl font-bold">{t('preferencesTitle')}</h1>
    <p className="text-sm text-muted-foreground">{t('preferencesDescription')}</p>
    <MarketingPreferences locale={locale} audience="employer" uiState={uiState} />
  </main>
}
