import Constants from 'expo-constants'
import { StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { paletteFor, spacing } from '@/theme/tokens'

// MA0 骨架页：只显示品牌名和构建信息。正式页面和文案在 MA2 接入 i18n 后再做。
export default function Index() {
  const palette = paletteFor(useColorScheme())
  const extra = Constants.expoConfig?.extra as { variant?: string } | undefined
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: palette.background }]}>
      <View style={styles.center}>
        <Text accessibilityRole="header" style={[styles.wordmark, { color: palette.brand }]}>
          FindMYJob
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
  meta: { fontSize: 14 },
})
