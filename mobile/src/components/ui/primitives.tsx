import { useEffect, useState, type ReactNode } from 'react'
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'

import { useTheme } from '@/theme/use-theme'

export function Card({ children, style, onPress, accessibilityLabel }: {
  children: ReactNode
  style?: ViewStyle
  onPress?: () => void
  accessibilityLabel?: string
}) {
  const { colors, radius } = useTheme()
  const body = (
    <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radius.card }, style]}>
      {children}
    </View>
  )
  if (!onPress) return body
  // 列表卡片合并成一个可读单元，TalkBack 读一次就够（MOBILE.md §5.6）
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
      {body}
    </Pressable>
  )
}

export function Chip({ label, selected = false, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const { colors, radius, minTouchTarget } = useTheme()
  return (
    <Pressable
      accessibilityRole={onPress ? 'checkbox' : 'text'}
      accessibilityState={onPress ? { checked: selected } : undefined}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.chip,
        {
          // 非交互的标签可以矮一些；可点的 chip 至少 48dp 触控高度（用 hitSlop 补足）
          minHeight: onPress ? 36 : 28,
          borderRadius: radius.pill,
          backgroundColor: selected ? colors.brand : colors.brandMuted,
        },
      ]}
      hitSlop={onPress ? (minTouchTarget - 36) / 2 : 0}
    >
      <Text style={[styles.chipText, { color: selected ? colors.brandForeground : colors.brandMutedForeground }]}>{label}</Text>
    </Pressable>
  )
}

export function Skeleton({ height = 16, width = '100%', radius: r = 8 }: { height?: number; width?: number | `${number}%`; radius?: number }) {
  const { colors } = useTheme()
  const [opacity] = useState(() => new Animated.Value(0.5))
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height, width, borderRadius: r, backgroundColor: colors.muted, opacity }}
    />
  )
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  const { colors } = useTheme()
  return (
    <View style={styles.empty} accessibilityRole="summary">
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      {body ? <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{body}</Text> : null}
      {action}
    </View>
  )
}

export function SectionTitle({ children }: { children: string }) {
  const { colors } = useTheme()
  return (
    <Text accessibilityRole="header" style={[styles.section, { color: colors.foreground }]}>
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth * 2, padding: 16, gap: 8 },
  chip: { paddingHorizontal: 12, justifyContent: 'center', alignSelf: 'flex-start' },
  chipText: { fontSize: 14, fontWeight: '500' },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  section: { fontSize: 20, fontWeight: '600', marginTop: 8 },
})
