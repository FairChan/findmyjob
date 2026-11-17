import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useTheme } from '@/theme/use-theme'

/** 分段切换（投递页：进行中 / 已结束 / 邀请）；TalkBack 读作标签页并报选中态 */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; badge?: number }[]
  value: T
  onChange: (next: T) => void
}) {
  const { colors, radius, minTouchTarget } = useTheme()
  return (
    <View accessibilityRole="tablist" style={[styles.root, { backgroundColor: colors.muted, borderRadius: radius.button }]}>
      {options.map((o) => {
        const selected = o.value === value
        const label = o.badge ? `${o.label} (${o.badge})` : o.label
        return (
          <Pressable
            key={o.value}
            testID={`segment-${o.value}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            onPress={() => onChange(o.value)}
            style={[
              styles.item,
              { minHeight: minTouchTarget, borderRadius: radius.button - 2, backgroundColor: selected ? colors.background : 'transparent' },
            ]}
          >
            <Text numberOfLines={1} style={[styles.text, { color: selected ? colors.foreground : colors.mutedForeground, fontWeight: selected ? '600' : '500' }]}>
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', padding: 3, gap: 3 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  text: { fontSize: 15 },
})
