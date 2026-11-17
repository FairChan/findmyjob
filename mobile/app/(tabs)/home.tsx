import type { MobileProfileCompleteness, MobileQuota } from '@shared/mobile-api'
import { useRouter } from 'expo-router'
import { Bell, ShieldAlert } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Card, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, SectionTitle, Skeleton } from '@/components/ui'
import { useMe } from '@/features/auth/use-me'
import { remaining, useJobs } from '@/features/jobs/api'
import { JobCard } from '@/features/jobs/components'
import { useUnreadCount } from '@/features/notifications/api'
import { useCompleteness, useProfile } from '@/features/profile/api'
import { useReferrals } from '@/features/referrals/api'
import { useErrorMessage } from '@/i18n/error-message'
import { useTheme } from '@/theme/use-theme'

const RECOMMENDED = 5

/** S07 首页：问候、建档/完成度、额度、防骗提示、推荐职位（= 职位列表第一页，不扣额度） */
export default function Home() {
  const router = useRouter()
  const { me } = useMe()
  const t = useTranslations('mobile.home')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const profile = useProfile()
  const completeness = useCompleteness()
  const referrals = useReferrals()
  const jobs = useJobs({})
  const unread = useUnreadCount()

  const refreshing = profile.isRefetching || completeness.isRefetching || referrals.isRefetching || jobs.isRefetching
  const name = profile.data?.fullName || me?.name || ''
  const recommended = jobs.data?.pages[0]?.items.slice(0, RECOMMENDED) ?? []

  return (
    <Screen
      onRefresh={() => void Promise.all([profile.refetch(), completeness.refetch(), referrals.refetch(), jobs.refetch()])}
      refreshing={refreshing}
    >
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.greeting, { color: colors.foreground }]} numberOfLines={2}>
          {t('greeting', { name })}
        </Text>
        <BellButton count={unread} onPress={() => router.push('/notifications')} />
      </View>
      <OfflineBanner />

      {profile.data && profile.data.onboardingStep < 5 ? <OnboardingCard onPress={() => router.push('/onboarding')} /> : null}

      {completeness.isPending ? (
        <Card>
          <Skeleton height={18} width="50%" />
          <Skeleton height={8} />
        </Card>
      ) : completeness.data ? (
        <CompletenessCard data={completeness.data} />
      ) : null}

      {referrals.data ? <QuotaCard quota={referrals.data.quota} onInvite={() => router.push('/invite')} /> : null}

      <Card onPress={() => router.push('/help')} accessibilityLabel={`${t('safetyTip')} ${t('safetyMore')}`}>
        <View style={styles.row}>
          <ShieldAlert color={colors.brand} size={20} />
          <Text style={[styles.flex, { color: colors.foreground, lineHeight: 21 }]}>{t('safetyTip')}</Text>
        </View>
        <Text style={{ color: colors.brand, fontWeight: '600' }}>{t('safetyMore')}</Text>
      </Card>

      <SectionTitle>{t('recommended')}</SectionTitle>
      {jobs.isPending ? (
        <ListSkeleton rows={3} />
      ) : jobs.isError ? (
        <ErrorState message={errorMessage(jobs.error)} onRetry={() => void jobs.refetch()} />
      ) : recommended.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <View style={styles.list}>
          {recommended.map((job) => (
            <JobCard key={job.id} job={job} onPress={() => router.push(`/jobs/${job.id}`)} />
          ))}
          <Button label={t('seeAllJobs')} variant="secondary" onPress={() => router.push('/jobs')} />
        </View>
      )}
    </Screen>
  )
}

function BellButton({ count, onPress }: { count: number; onPress: () => void }) {
  const { colors, minTouchTarget } = useTheme()
  const t = useTranslations('mobile.home')
  return (
    <Pressable
      testID="home-bell"
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? t('notificationsUnread', { count }) : t('notifications')}
      onPress={onPress}
      style={[styles.bell, { width: minTouchTarget, height: minTouchTarget }]}
    >
      <Bell color={colors.foreground} size={24} />
      {count > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.destructive }]}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

function OnboardingCard({ onPress }: { onPress: () => void }) {
  const t = useTranslations('mobile.onboarding')
  const { colors } = useTheme()
  return (
    <Card style={{ backgroundColor: colors.brandMuted, borderColor: colors.brandMuted }}>
      <Text style={[styles.cardTitle, { color: colors.brandMutedForeground }]}>{t('cardTitle')}</Text>
      <Text style={{ color: colors.brandMutedForeground }}>{t('cardBody')}</Text>
      <Button testID="home-onboarding" label={t('cardAction')} onPress={onPress} />
    </Card>
  )
}

function CompletenessCard({ data }: { data: MobileProfileCompleteness }) {
  const router = useRouter()
  const t = useTranslations('mobile.home')
  const todo = useTranslations('studentDashboard')
  const { colors, radius } = useTheme()
  const items = [
    !data.hasResume && { key: 'resume', label: todo('todoUploadResume'), go: '/resumes' },
    !data.schoolVerified && { key: 'school', label: todo('todoVerifySchool'), go: '/school-verification' },
    !data.talentPoolEnabled && { key: 'pool', label: todo('todoEnableTalentPool'), go: '/privacy' },
  ].filter(Boolean) as { key: string; label: string; go: string }[]
  return (
    <Card>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t('completeness', { percent: data.completeness })}</Text>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: data.completeness }}
        style={[styles.track, { backgroundColor: colors.muted, borderRadius: radius.pill }]}
      >
        <View style={[styles.fill, { width: `${Math.min(data.completeness, 100)}%`, backgroundColor: colors.brand, borderRadius: radius.pill }]} />
      </View>
      {items.map((i) => (
        <Button key={i.key} label={i.label} variant="ghost" onPress={() => router.push(i.go)} />
      ))}
      <Button label={t('completeProfile')} variant="secondary" onPress={() => router.push('/profile')} />
    </Card>
  )
}

function QuotaCard({ quota, onInvite }: { quota: MobileQuota; onInvite: () => void }) {
  const t = useTranslations('mobile.home')
  const invite = useTranslations('invite')
  const { colors } = useTheme()
  const left = remaining(quota)
  return (
    <Card>
      <Text testID="home-quota" style={[styles.cardTitle, { color: colors.foreground }]}>
        {left === null ? invite('alreadyUnlimited') : t('quota', { count: left })}
      </Text>
      {left !== null ? <Button label={t('inviteFriends')} variant="ghost" onPress={onInvite} /> : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  greeting: { flex: 1, fontSize: 26, fontWeight: '700' },
  bell: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  flex: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  track: { height: 8, overflow: 'hidden' },
  fill: { height: 8 },
  list: { gap: 12 },
})
