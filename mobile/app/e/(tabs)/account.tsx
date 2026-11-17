import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { Mail, Settings } from 'lucide-react-native'
import { StyleSheet, Text } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Card, ListRow, Screen } from '@/components/ui'
import { useMe } from '@/features/auth/use-me'
import { useSignOut } from '@/features/auth/use-sign-out'
import { useWallet } from '@/features/employer/api'
import { useTheme } from '@/theme/use-theme'

/**
 * E09 企业"我的"：账号、点数余额（只读）、已发邀请、设置（E10，与学生共用设置页，只显示通用项）、退出登录。
 * 团队、企业资料、账单只在网页版；这里不放任何购买或账单入口。
 */
export default function EmployerAccount() {
  const router = useRouter()
  const signOut = useSignOut()
  const { me } = useMe()
  const wallet = useWallet()
  const t = useTranslations('mobile')
  const { colors } = useTheme()
  const balance = wallet.data?.balance
  return (
    <Screen onRefresh={() => void wallet.refetch()} refreshing={wallet.isRefetching}>
      <Card>
        <Text accessibilityRole="header" style={[styles.name, { color: colors.foreground }]}>
          {me?.name ?? ''}
        </Text>
        <Text style={{ color: colors.mutedForeground }}>{me?.email ?? ''}</Text>
      </Card>
      <Card>
        <ListRow testID="e-account-balance" label={t('employer.balance')} value={balance === undefined || balance === null ? '—' : t('employer.credits', { count: balance })} />
        <Text style={[styles.note, { color: colors.mutedForeground }]}>{t('employer.balanceReadOnly')}</Text>
      </Card>
      <Card>
        <ListRow testID="e-account-invitations" icon={<Mail color={colors.brand} size={20} />} label={t('employer.linkInvitations')} onPress={() => router.push('/e/invitations')} />
        <ListRow testID="e-account-settings" icon={<Settings color={colors.brand} size={20} />} label={t('settings.title')} onPress={() => router.push('/settings')} />
      </Card>
      <Text style={[styles.note, { color: colors.mutedForeground }]}>{t('employer.moreOnWeb')}</Text>
      <Button testID="e-account-sign-out" label={t('auth.signOut')} variant="secondary" onPress={signOut} />
      <Text style={[styles.version, { color: colors.mutedForeground }]}>{t('me.version', { version: Constants.expoConfig?.version ?? '' })}</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 20, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 18 },
  version: { textAlign: 'center', fontSize: 13 },
})
