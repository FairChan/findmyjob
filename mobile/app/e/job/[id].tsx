import { useLocalSearchParams, useRouter } from 'expo-router'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useFormatter, useTranslations } from 'use-intl'

import { Card, Chip, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, TopBar } from '@/components/ui'
import { useApplicants } from '@/features/employer/api'
import { TalentSummary, useApplicationStatusLabel } from '@/features/employer/components'
import { useEmployerError } from '@/features/employer/errors'
import { useTheme } from '@/theme/use-theme'

/** E03 某职位的候选人列表（不含已撤回）；学生信息只来自 talent-card 序列化输出 */
export default function JobApplicants() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const format = useFormatter()
  const t = useTranslations('mobile.employer')
  const ap = useTranslations('applicants')
  const status = useApplicationStatusLabel()
  const employerError = useEmployerError()
  const { colors } = useTheme()
  const q = useApplicants(id)

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <TopBar title={q.data?.jobTitle ?? t('applicantsTitle')} />
        <OfflineBanner />
      </View>
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState message={employerError(q.error, 'view')} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          testID="e-applicants"
          data={q.data.items}
          keyExtractor={(a) => a.applicationId}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={Separator}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
          ListEmptyComponent={<EmptyState title={ap('noApplicants')} />}
          renderItem={({ item }) => (
            <View testID={`e-applicant-${item.applicationId}`}>
              <Card
                onPress={() => router.push(`/e/applicant/${item.applicationId}`)}
                accessibilityLabel={[item.card.name, status(item.status), item.card.major, t('completeness', { percent: item.card.completeness })].filter(Boolean).join('，')}
              >
                <TalentSummary card={item.card} />
                <View style={styles.row}>
                  <Chip label={status(item.status)} />
                  <Text style={{ color: colors.mutedForeground }}>{t('appliedOn', { date: format.dateTime(new Date(item.createdAt), { dateStyle: 'medium' }) })}</Text>
                </View>
              </Card>
            </View>
          )}
        />
      )}
    </Screen>
  )
}

function Separator() {
  return <View style={styles.sep} />
}

const styles = StyleSheet.create({
  header: { gap: 8, paddingTop: 8, paddingBottom: 8 },
  content: { paddingBottom: 24 },
  sep: { height: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
})
