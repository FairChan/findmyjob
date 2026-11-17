import { Check } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useTheme } from '@/theme/use-theme'

export function Checkbox({ checked, onChange, label, extra }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  /** 标签后面的补充（如"查看用户协议"链接），不参与勾选 */
  extra?: ReactNode
}) {
  const { colors, minTouchTarget } = useTheme()
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        onPress={() => onChange(!checked)}
        style={[styles.hit, { minHeight: minTouchTarget }]}
      >
        <View style={[styles.box, { borderColor: checked ? colors.brand : colors.border, backgroundColor: checked ? colors.brand : 'transparent' }]}>
          {checked ? <Check size={16} color={colors.brandForeground} strokeWidth={3} /> : null}
        </View>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      </Pressable>
      {extra}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { gap: 2 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 15, lineHeight: 21 },
})
