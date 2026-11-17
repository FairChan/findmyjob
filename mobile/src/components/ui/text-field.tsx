import { forwardRef, useId, type ComponentRef } from 'react'
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'

import { useTheme } from '@/theme/use-theme'

type Props = TextInputProps & { label: string; error?: string | null; helper?: string }

/** 带标签、错误和说明的输入框；错误用 accessibilityLiveRegion 播报 */
export const TextField = forwardRef<ComponentRef<typeof TextInput>, Props>(function TextField({ label, error, helper, style, ...rest }, ref) {
  const { colors, radius, minTouchTarget } = useTheme()
  const id = useId()
  return (
    <View style={styles.wrap}>
      <Text nativeID={`${id}-label`} style={[styles.label, { color: colors.foreground }]}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityLabelledBy={`${id}-label`}
        accessibilityHint={error ?? helper}
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.input,
          {
            minHeight: minTouchTarget,
            borderRadius: radius.button,
            color: colors.foreground,
            borderColor: error ? colors.destructive : colors.border,
            backgroundColor: colors.background,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.note, { color: colors.destructive }]}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={[styles.note, { color: colors.mutedForeground }]}>{helper}</Text>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 15, fontWeight: '500' },
  // 16 号字：避免系统放大输入框、也和 Web 的 16px 一致
  input: { borderWidth: StyleSheet.hairlineWidth * 2, paddingHorizontal: 14, fontSize: 16 },
  note: { fontSize: 13, lineHeight: 18 },
})
