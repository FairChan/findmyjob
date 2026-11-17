import { useLocalSearchParams, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { BadgeCheck } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Card, Chip, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, SectionTitle, TopBar } from '@/components/ui'
import { safeWebsite, useCompany } from '@/features/companies/api'
import { companyName, useJobLabels, useSalaryText } from '@/features/jobs/components'
import { useErrorMessage } from '@/i18n/error-message'
import { ApiError } from '@/lib/api-client'
import { useTheme } from '@/theme/use-theme'

/** S15 企业主页：简介、认证标识、在招职位（点进去是预览，不扣额度） */
export default function CompanyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const locale = useLocale()
  const browser = useTranslations('companyBrowser')
  const m = useTranslations('mobile.companies')
  const errorMessage = useErrorMessage()
  const labels = useJobLabels()
  const salary = useSalaryText()
  const { colors } = useTheme()
  const query = useCompany(id)

  if (query.isPending)
    return (
      <Screen>
        <TopBar title={m('title')} />
        <ListSkeleton rows={2} />
      </Screen>
    )
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.code === 'NOT_FOUND'
    return (
      <Screen>
        <TopBar title={m('title')} />
        {missing ? (
          <EmptyState title={browser('missingTitle')} body={browser('missingDescription')} />
        ) : (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        )}
      </Screen>
    )
  }

  const c = query.data.pages[0]!.company
  const jobs = query.data.pages.flatMap((p) => p.jobs.items)
  const website = safeWebsite(c.website)
  const name = companyName(c, locale)
  return (
    <Screen onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <TopBar title={name} />
      <OfflineBanner />
      <View style={styles.badges}>
        <View style={styles.row}>
          <BadgeCheck color={colors.brand} size={18} />
          <Text style={{ color: colors.brand }}>{m('verified')}</Text>
        </View>
        {c.isFoundingPartner ? <Chip label={m('foundingPartner')} /> : null}
      </View>
      {c.legalName !== name ? <Text style={{ color: colors.mutedForeground }}>{c.legalName}</Text> : null}
      <Text style={[styles.body, { color: colors.foreground }]}>{c.description || browser('noDescription')}</Text>
      {website ? <Button label={m('website')} variant="secondary" accessibilityHint={website} onPress={() => void WebBrowser.openBrowserAsync(website)} /> : null}

      <SectionTitle>{browser('openJobs')}</SectionTitle>
      {jobs.length === 0 ? (
        <EmptyState title={browser('noJobs')} />
      ) : (
        <View style={styles.list}>
          {jobs.map((j) => {
            const meta = [labels.type(j.type), labels.workMode(j.workMode), labels.location(j.state, j.city)].filter(Boolean).join(' · ')
            const pay = salary(j.salaryMin, j.salaryMax)
            return (
              <Card key={j.id} onPress={() => router.push(`/jobs/${j.id}`)} accessibilityLabel={[j.title, meta, pay].join('，')}>
                <Text style={[styles.jobTitle, { color: colors.foreground }]}>{j.title}</Text>
                <Text style={{ color: colors.mutedForeground }}>{meta}</Text>
                <Text style={{ color: colors.brand, fontWeight: '600' }}>{pay}</Text>
              </Card>
            )
          })}
          {query.hasNextPage ? (
            <Button label={browser('nextJobs')} variant="secondary" loading={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} />
          ) : null}
        </View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  body: { fontSize: 16, lineHeight: 24 },
  list: { gap: 12 },
  jobTitle: { fontSize: 17, fontWeight: '600' },
})
