import { ChevronRight } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'

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
  switchText: { flex: 1, gap: 2 },
  description: { fontSize: 13, lineHeight: 18 },
})

/** 开关行：整行可点，TalkBack 读作开关并报开/关状态 */
export function SwitchRow({ label, description, value, onChange, disabled = false, testID }: {
  label: string
  description?: string
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  testID?: string
}) {
  const { colors, minTouchTarget } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[styles.row, { minHeight: minTouchTarget + 8, borderBottomColor: colors.border, opacity: disabled ? 0.5 : 1 }]}
    >
      <View style={styles.switchText}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        {description ? <Text style={[styles.description, { color: colors.mutedForeground }]}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        trackColor={{ true: colors.brand, false: colors.muted }}
        thumbColor={colors.background}
      />
    </Pressable>
  )
}
