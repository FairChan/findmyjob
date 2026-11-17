import { useQueryClient } from '@tanstack/react-query'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { BadgeCheck, Bell, FileText, Gift, LifeBuoy, Lock, Settings, UserRound } from 'lucide-react-native'
import { StyleSheet, Text } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Card, ListRow, Screen } from '@/components/ui'
import { signOut } from '@/features/auth/actions'
import { useMe } from '@/features/auth/use-me'
import { useCompleteness } from '@/features/profile/api'
import { useTheme } from '@/theme/use-theme'

/** "我的"（MOBILE.md §5.3）：档案与简历、学校认证、邀请同学、通知、隐私、设置、帮助与防骗 */
export default function MeTab() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { me } = useMe()
  const completeness = useCompleteness()
  const t = useTranslations('mobile')
  const { colors } = useTheme()
  const icon = (I: typeof UserRound) => <I color={colors.brand} size={20} />
  const c = completeness.data
  return (
    <Screen onRefresh={() => void completeness.refetch()} refreshing={completeness.isRefetching}>
      <Card>
        <Text accessibilityRole="header" style={[styles.name, { color: colors.foreground }]}>
          {me?.name ?? ''}
        </Text>
        <Text style={{ color: colors.mutedForeground }}>{me?.email ?? ''}</Text>
        {c ? <Text style={{ color: colors.foreground }}>{t('home.completeness', { percent: c.completeness })}</Text> : null}
      </Card>
      <Card>
        <ListRow testID="me-profile" icon={icon(UserRound)} label={t('me.profile')} onPress={() => router.push('/profile')} />
        <ListRow testID="me-resumes" icon={icon(FileText)} label={t('profile.resumes')} onPress={() => router.push('/resumes')} />
        <ListRow
          testID="me-school"
          icon={icon(BadgeCheck)}
          label={t('me.schoolVerify')}
          value={c?.schoolVerified ? t('profile.verified') : undefined}
          onPress={() => router.push('/school-verification')}
        />
        <ListRow testID="me-invite" icon={icon(Gift)} label={t('me.invite')} onPress={() => router.push('/invite')} />
      </Card>
      <Card>
        <ListRow testID="me-notifications" icon={icon(Bell)} label={t('tabs.notifications')} onPress={() => router.push('/notifications')} />
        <ListRow testID="me-privacy" icon={icon(Lock)} label={t('me.privacy')} onPress={() => router.push('/privacy')} />
        <ListRow testID="me-settings" icon={icon(Settings)} label={t('settings.title')} onPress={() => router.push('/settings')} />
        <ListRow testID="me-help" icon={icon(LifeBuoy)} label={t('me.help')} onPress={() => router.push('/help')} />
      </Card>
      <Button
        testID="me-sign-out"
        label={t('auth.signOut')}
        variant="secondary"
        onPress={async () => {
          await signOut().catch(() => {})
          queryClient.clear()
          router.replace('/welcome')
        }}
      />
      <Text style={[styles.version, { color: colors.mutedForeground }]}>{t('me.version', { version: Constants.expoConfig?.version ?? '' })}</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 20, fontWeight: '600' },
  version: { textAlign: 'center', fontSize: 13 },
})
