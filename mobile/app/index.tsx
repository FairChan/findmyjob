import { Redirect } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button } from '@/components/ui'
import { useMe } from '@/features/auth/use-me'
import { useErrorMessage } from '@/i18n/error-message'
import { useTheme } from '@/theme/use-theme'

/** 启动分流：未登录 → 欢迎页；学生 → 主界面；企业和管理员 → 先提示用网页版（企业版是 v1.1） */
export default function Gate() {
  const { loading, signedIn, me, error, refetch } = useMe()
  const { colors } = useTheme()
  const t = useTranslations('mobile.common')
  const errorMessage = useErrorMessage()

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text accessibilityRole="header" style={[styles.wordmark, { color: colors.brand }]}>
          FindMYJob
        </Text>
        <ActivityIndicator color={colors.brand} accessibilityLabel={t('loading')} />
      </View>
    )
  }
  if (!signedIn) return <Redirect href="/welcome" />
  if (error || !me) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground }}>{errorMessage(error)}</Text>
        <Button label={t('retry')} onPress={() => void refetch()} />
      </View>
    )
  }
  if (me.role !== 'STUDENT') return <Redirect href="/employer" />
  return <Redirect href="/home" />
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  wordmark: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
})
