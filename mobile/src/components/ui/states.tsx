import { WifiOff } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'
import { Button } from './button'
import { Card, Skeleton } from './primitives'

/** 加载失败：文案只来自错误码映射（useErrorMessage），绝不显示服务端原文 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme()
  const t = useTranslations('mobile.common')
  return (
    <View style={styles.error} accessibilityLiveRegion="polite" testID="error-state">
      <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.foreground }]}>
        {message}
      </Text>
      {onRetry ? <Button label={t('retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  )
}

/** 列表骨架：代替菊花（MOBILE.md §5.1 弱网友好） */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  const t = useTranslations('mobile.common')
  return (
    <View style={styles.list} accessible accessibilityLabel={t('loading')} testID="list-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i}>
          <Skeleton height={18} width="70%" />
          <Skeleton height={14} width="45%" />
          <Skeleton height={14} width="30%" />
        </Card>
      ))}
    </View>
  )
}

/** 离线横幅：缓存的数据照常显示，写操作按钮另外禁用并说明原因 */
export function OfflineBanner() {
  const online = useOnline()
  const { colors, radius } = useTheme()
  const t = useTranslations('mobile.common')
  if (online) return null
  return (
    <View
      testID="offline-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: colors.muted, borderRadius: radius.button }]}
    >
      <WifiOff color={colors.foreground} size={18} />
      <Text style={[styles.bannerText, { color: colors.foreground }]}>{t('offline')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  error: { alignItems: 'center', gap: 12, paddingVertical: 32, paddingHorizontal: 16 },
  errorText: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
  list: { gap: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20 },
})
