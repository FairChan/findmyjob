import { useRouter } from 'expo-router'
import { ShieldAlert } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Card, ErrorState, ListRow, OfflineBanner, Screen, Skeleton } from '@/components/ui'
import { useMe } from '@/features/auth/use-me'
import { useCompanyInvitations, useEmployerJobs, useWallet } from '@/features/employer/api'
import { useErrorMessage } from '@/i18n/error-message'
import { useTheme } from '@/theme/use-theme'

/**
 * E01 工作台：认证状态、点数余额（只读，App 内没有任何购买入口）、在招职位和投递数、本月邀请用量。
 * 这里只调不计数的接口；人才库不在工作台预取。
 * 企业端整个外壳不打开任何网页（Web 企业后台的导航里有账单和购买入口），需要去网页版的事只用文字说明。
 */
export default function EmployerDashboard() {
  const router = useRouter()
  const { me } = useMe()
  const t = useTranslations('mobile.employer')
  const dash = useTranslations('employerDashboard')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const wallet = useWallet()
  const jobs = useEmployerJobs()
  const invitations = useCompanyInvitations()

  const published = jobs.data?.items.filter((j) => j.status === 'PUBLISHED') ?? []
  const applications = published.reduce((n, j) => n + j.applicationCount, 0)
  const usage = invitations.data?.usage
  // 余额为 null = 企业还没通过认证（与 Web 工作台一致）
  const unverified = wallet.data !== undefined && wallet.data.balance === null

  return (
    <Screen
      onRefresh={() => void Promise.all([wallet.refetch(), jobs.refetch(), invitations.refetch()])}
      refreshing={wallet.isRefetching || jobs.isRefetching || invitations.isRefetching}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {dash('title')}
      </Text>
      {me?.name ? <Text style={{ color: colors.mutedForeground }}>{me.name}</Text> : null}
      <OfflineBanner />

      {unverified ? (
        <Card style={{ borderColor: colors.destructive }}>
          <View style={styles.row}>
            <ShieldAlert color={colors.destructive} size={20} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{dash('bannerUnsubmittedTitle')}</Text>
          </View>
          <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>{t('unverifiedBody')}</Text>
        </Card>
      ) : null}

      <Card>
        <Text style={{ color: colors.mutedForeground }}>{dash('creditsBalance')}</Text>
        {wallet.isPending ? (
          <Skeleton height={32} width="40%" />
        ) : wallet.isError ? (
          <ErrorState message={errorMessage(wallet.error)} onRetry={() => void wallet.refetch()} />
        ) : (
          <Text testID="e-balance" style={[styles.big, { color: colors.foreground }]}>
            {wallet.data.balance === null ? '—' : t('credits', { count: wallet.data.balance })}
          </Text>
        )}
        <Text style={[styles.note, { color: colors.mutedForeground }]}>{t('balanceReadOnly')}</Text>
      </Card>

      <Card>
        {jobs.isPending ? (
          <Skeleton height={20} width="60%" />
        ) : jobs.isError ? (
          <ErrorState message={errorMessage(jobs.error)} onRetry={() => void jobs.refetch()} />
        ) : (
          <Text testID="e-jobs-summary" style={[styles.cardTitle, { color: colors.foreground }]}>
            {t('jobsSummary', { jobs: published.length, applications })}
          </Text>
        )}
        {usage ? (
          <Text style={{ color: colors.mutedForeground }}>
            {usage.quota === null ? t('invitesUsedUnlimited', { used: usage.used }) : t('invitesUsed', { used: usage.used, quota: usage.quota })}
          </Text>
        ) : null}
      </Card>

      <Card>
        <ListRow testID="e-link-jobs" label={t('linkJobs')} onPress={() => router.push('/e/jobs')} />
        <ListRow testID="e-link-talent" label={t('linkTalent')} onPress={() => router.push('/e/talent')} />
        <ListRow testID="e-link-invitations" label={t('linkInvitations')} onPress={() => router.push('/e/invitations')} />
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '600', flex: 1 },
  big: { fontSize: 30, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 18 },
})
