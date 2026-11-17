import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useFormatter, useTranslations } from 'use-intl'

import { Card, Chip, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, TopBar } from '@/components/ui'
import { useCompanyInvitations } from '@/features/employer/api'
import { TalentSummary } from '@/features/employer/components'
import { useErrorMessage } from '@/i18n/error-message'
import { useTheme } from '@/theme/use-theme'

/** E08 已发邀请：本月用量和每条邀请的状态（不可见的学生已被服务端过滤） */
export default function SentInvitations() {
  const inv = useTranslations('invitations')
  const format = useFormatter()
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const q = useCompanyInvitations()
  const status = { SENT: inv('statusSent'), ACCEPTED: inv('statusAccepted'), DECLINED: inv('statusDeclined'), EXPIRED: inv('statusExpired') }

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <TopBar title={inv('companyInvitationsTitle')} />
        <OfflineBanner />
        {q.data ? (
          <Text testID="e-invitations-usage" style={{ color: colors.mutedForeground }}>
            {q.data.usage.quota === null ? inv('inviteDialogQuotaUnlimited', { used: q.data.usage.used }) : inv('inviteDialogQuota', { used: q.data.usage.used, quota: q.data.usage.quota })}
          </Text>
        ) : null}
      </View>
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          testID="e-invitations"
          data={q.data.items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={Separator}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
          ListEmptyComponent={<EmptyState title={inv('companyEmpty')} />}
          renderItem={({ item }) => (
            <Card>
              <TalentSummary card={item.student} />
              {item.job ? <Text style={{ color: colors.foreground }}>{item.job.title}</Text> : null}
              <View style={styles.row}>
                <Chip label={status[item.status]} />
                <Text style={{ color: colors.mutedForeground }}>{inv('sentAt', { date: format.dateTime(new Date(item.createdAt), { dateStyle: 'medium' }) })}</Text>
              </View>
            </Card>
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
