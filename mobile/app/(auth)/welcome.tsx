import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Screen } from '@/components/ui'
import { useTheme } from '@/theme/use-theme'

/** S01 欢迎页：品牌 + 价值主张，主操作放在拇指区 */
export default function Welcome() {
  const router = useRouter()
  const t = useTranslations('mobile.auth')
  const brand = useTranslations('brandLine')
  const { colors } = useTheme()
  return (
    <Screen
      scroll={false}
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <>
          <Button testID="welcome-sign-up" label={t('signUp')} onPress={() => router.push('/sign-up')} fullWidth />
          <Button testID="welcome-sign-in" label={t('signIn')} variant="secondary" onPress={() => router.push('/sign-in')} fullWidth />
        </>
      }
    >
      <View style={styles.hero}>
        <Text accessibilityRole="header" style={[styles.wordmark, { color: colors.brand }]}>
          FindMYJob
        </Text>
        <Text style={[styles.line, { color: colors.foreground }]}>{`${brand('lead')} ${brand('words.right')} ${brand('tail')}`}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>{t('welcomeTitle')}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{t('welcomeBody')}</Text>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  hero: { flex: 1, justifyContent: 'center', gap: 12 },
  wordmark: { fontSize: 40, fontWeight: '700', letterSpacing: -0.8 },
  line: { fontSize: 20, fontWeight: '500' },
  title: { fontSize: 28, fontWeight: '700', lineHeight: 36, marginTop: 24 },
  body: { fontSize: 17, lineHeight: 26 },
})
