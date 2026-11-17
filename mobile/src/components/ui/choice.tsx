import { Check, ChevronDown } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { useTheme } from '@/theme/use-theme'
import { Chip } from './primitives'
import { Sheet } from './sheet'

export type Option<T extends string = string> = { value: T; label: string }

/** 单选下拉：点开底部抽屉选一项（Android 原生 Picker 在深色模式和字号放大下不可控，所以自己画） */
export function SelectField<T extends string>({ label, value, options, onChange, placeholder, error, testID, allowClear = false }: {
  label: string
  value: T | null
  options: Option<T>[]
  onChange: (next: T | null) => void
  placeholder?: string
  error?: string | null
  testID?: string
  allowClear?: boolean
}) {
  const { colors, radius, minTouchTarget } = useTheme()
  const t = useTranslations('mobile.common')
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${current?.label ?? placeholder ?? ''}`}
        accessibilityHint={error ?? undefined}
        onPress={() => setOpen(true)}
        style={[
          styles.field,
          { minHeight: minTouchTarget, borderRadius: radius.button, borderColor: error ? colors.destructive : colors.border, backgroundColor: colors.background },
        ]}
      >
        <Text style={[styles.value, { color: current ? colors.foreground : colors.mutedForeground }]} numberOfLines={2}>
          {current?.label ?? placeholder ?? ''}
        </Text>
        <ChevronDown color={colors.mutedForeground} size={20} />
      </Pressable>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.note, { color: colors.destructive }]}>
          {error}
        </Text>
      ) : null}
      <Sheet open={open} onClose={() => setOpen(false)} title={label} closeLabel={t('close')}>
        <ScrollView style={styles.sheetList}>
          {allowClear ? (
            <OptionRow label={placeholder ?? t('none')} selected={value === null} onPress={() => { onChange(null); setOpen(false) }} />
          ) : null}
          {options.map((o) => (
            <OptionRow
              key={o.value}
              label={o.label}
              selected={o.value === value}
              onPress={() => {
                onChange(o.value)
                setOpen(false)
              }}
            />
          ))}
        </ScrollView>
      </Sheet>
    </View>
  )
}

function OptionRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors, minTouchTarget } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.option, { minHeight: minTouchTarget, borderBottomColor: colors.border }]}
    >
      <Text style={[styles.optionText, { color: colors.foreground, fontWeight: selected ? '600' : '400' }]}>{label}</Text>
      {selected ? <Check color={colors.brand} size={20} /> : null}
    </Pressable>
  )
}

/** 多选（或单选）chip 组；整组有一个标题，供 TalkBack 读出上下文 */
export function ChipGroup<T extends string>({ label, options, selected, onToggle, testIDPrefix }: {
  label: string
  options: Option<T>[]
  selected: readonly T[]
  onToggle: (value: T) => void
  testIDPrefix?: string
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.wrap} accessibilityLabel={label}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => (
          <View key={o.value} testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined}>
            <Chip label={o.label} selected={selected.includes(o.value)} onPress={() => onToggle(o.value)} />
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 15, fontWeight: '500' },
  field: { borderWidth: StyleSheet.hairlineWidth * 2, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { flex: 1, fontSize: 16 },
  note: { fontSize: 13, lineHeight: 18 },
  sheetList: { flexGrow: 0 },
  option: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  optionText: { flex: 1, fontSize: 16 },
  // chip 本身 36 高，靠 hitSlop 补到 48；行间距留出 12，避免相邻 chip 的触控区重叠
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 12 },
})
