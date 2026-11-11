import { headers } from 'next/headers'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireEmployer } from '@/server/authz'
import { getMarketingUiState } from '@/server/services/marketing-consent'
import { MarketingPreferences } from '@/components/privacy/MarketingPreferences'
import { WorkspacePage } from '@/components/layout/workspace-page'

export default async function EmployerPreferencesPage() {
  const { userId } = await requireEmployer(await headers())
  const locale = await getLocale(), t = await getTranslations('marketing')
  const state = await getMarketingUiState({ userId })
  const uiState = { available: state.available, consentGranted: state.consentGranted, legalVersion: state.legalVersion }
  return <WorkspacePage title={t('preferencesTitle')} lead={t('preferencesDescription')}>
    <MarketingPreferences locale={locale} audience="employer" uiState={uiState} />
  </WorkspacePage>
}
