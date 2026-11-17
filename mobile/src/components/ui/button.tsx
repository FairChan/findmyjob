import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native'

import { useTheme } from '@/theme/use-theme'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string
  variant?: ButtonVariant
  loading?: boolean
  icon?: ReactNode
  fullWidth?: boolean
}

export function Button({ label, variant = 'primary', loading = false, disabled, icon, fullWidth, ...rest }: Props) {
  const { colors, radius, minTouchTarget } = useTheme()
  const isDisabled = disabled || loading
  const palette = {
    primary: { bg: colors.brand, fg: colors.brandForeground, border: colors.brand },
    secondary: { bg: colors.background, fg: colors.foreground, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.brand, border: 'transparent' },
    destructive: { bg: colors.destructive, fg: colors.brandForeground, border: colors.destructive },
  }[variant]

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: minTouchTarget,
          borderRadius: radius.button,
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'auto',
        },
      ]}
      {...rest}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={palette.fg} /> : icon}
        <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: { borderWidth: StyleSheet.hairlineWidth * 2, paddingHorizontal: 20, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { fontSize: 16, fontWeight: '600' },
})
