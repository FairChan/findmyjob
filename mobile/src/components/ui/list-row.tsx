import { ChevronRight } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useTheme } from '@/theme/use-theme'

/** 菜单行（"我的"、设置页）：整行一个可点单元，≥ 48dp */
export function ListRow({ label, value, icon, onPress, destructive = false, testID, accessibilityHint }: {
  label: string
  value?: string
  icon?: ReactNode
  onPress?: () => void
  destructive?: boolean
  testID?: string
  accessibilityHint?: string
}) {
  const { colors, minTouchTarget } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={accessibilityHint}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 8, borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={[styles.label, { color: destructive ? colors.destructive : colors.foreground }]}>{label}</Text>
      {value ? <Text style={[styles.value, { color: colors.mutedForeground }]}>{value}</Text> : null}
      {onPress ? <ChevronRight color={colors.mutedForeground} size={20} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  icon: { width: 24, alignItems: 'center' },
  label: { flex: 1, fontSize: 16 },
  value: { fontSize: 15, maxWidth: '45%' },
})
