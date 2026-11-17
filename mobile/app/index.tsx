import Constants from 'expo-constants'
import { StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslations } from 'use-intl'

import { paletteFor, spacing } from '@/theme/tokens'

// MA0 骨架页：品牌名 + 品牌句（取自 Web 的 brandLine 文案）+ 构建信息。正式首页在 MA2 做。
export default function Index() {
  const palette = paletteFor(useColorScheme())
  const t = useTranslations('brandLine')
  const extra = Constants.expoConfig?.extra as { variant?: string } | undefined
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: palette.background }]}>
      <View style={styles.center}>
        <Text accessibilityRole="header" style={[styles.wordmark, { color: palette.brand }]}>
          FindMYJob
        </Text>
        <Text testID="brand-line" style={[styles.line, { color: palette.foreground }]}>
          {`${t('lead')} ${t('words.right')} ${t('tail')}`}
        </Text>
        <Text testID="build-info" style={[styles.meta, { color: palette.mutedForeground }]}>
          {`${extra?.variant ?? 'dev'} · ${Constants.expoConfig?.version ?? ''}`}
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.page },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  wordmark: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  line: { fontSize: 17 },
  meta: { fontSize: 14 },
})
