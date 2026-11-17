import { useRouter } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { useTheme } from '@/theme/use-theme'

/**
 * 二级页面的顶栏：左侧返回（系统返回手势照常可用，这个按钮给 TalkBack 和单手用户），中间标题，右侧可放操作。
 * 不用原生 Stack header：标题、深色模式和字号缩放都由我们自己的 token 控制，测试里也不用 mock 导航器。
 */
export function TopBar({ title, right, onBack, showBack = true }: {
  title: string
  right?: ReactNode
  onBack?: () => void
  showBack?: boolean
}) {
  const router = useRouter()
  const { colors, minTouchTarget } = useTheme()
  const t = useTranslations('mobile.common')
  return (
    <View style={[styles.bar, { minHeight: minTouchTarget + 8 }]}>
      {showBack ? (
        <Pressable
          testID="top-bar-back"
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/home')))}
          style={[styles.icon, { width: minTouchTarget, height: minTouchTarget }]}
        >
          <ArrowLeft color={colors.foreground} size={24} />
        </Pressable>
      ) : null}
      <Text accessibilityRole="header" numberOfLines={2} style={[styles.title, { color: colors.foreground }]}>
        {title}
      </Text>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: -12 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 20, fontWeight: '600', paddingHorizontal: 8 },
  right: { flexDirection: 'row', alignItems: 'center' },
})
