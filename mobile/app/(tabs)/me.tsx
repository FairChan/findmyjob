import { useQueryClient } from '@tanstack/react-query'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { StyleSheet, Text } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Card, Screen } from '@/components/ui'
import { signOut } from '@/features/auth/actions'
import { useMe } from '@/features/auth/use-me'
import { useTheme } from '@/theme/use-theme'

// "我的"首版：账号信息 + 退出登录；档案、隐私、设置等入口在 MA2-T08 / T09 补齐
export default function MeTab() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { me } = useMe()
  const t = useTranslations('mobile')
  const { colors } = useTheme()
  return (
    <Screen>
      <Card>
        <Text accessibilityRole="header" style={[styles.name, { color: colors.foreground }]}>
          {me?.name ?? ''}
        </Text>
        <Text style={{ color: colors.mutedForeground }}>{me?.email ?? ''}</Text>
      </Card>
      <Button
        label={t('auth.signOut')}
        variant="secondary"
        onPress={async () => {
          await signOut()
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
