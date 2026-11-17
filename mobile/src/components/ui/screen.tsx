import type { ReactNode } from 'react'
import { KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'

import { useTheme } from '@/theme/use-theme'

/** 页面外壳：edge-to-edge 下避开系统栏，键盘弹出时上推，可选下拉刷新 */
export function Screen({ children, scroll = true, edges = ['top', 'left', 'right'], onRefresh, refreshing = false, footer }: {
  children: ReactNode
  scroll?: boolean
  edges?: Edge[]
  onRefresh?: () => void
  refreshing?: boolean
  /** 固定在底部的主操作区（拇指区） */
  footer?: ReactNode
}) {
  const { colors, spacing } = useTheme()
  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior="height" style={styles.root}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[styles.content, { paddingHorizontal: spacing.page }]}
            keyboardShouldPersistTaps="handled"
            refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} /> : undefined}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.root, { paddingHorizontal: spacing.page }]}>{children}</View>
        )}
        {footer ? (
          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingHorizontal: spacing.page }]}>{footer}</View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingVertical: 16, gap: 16 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12, gap: 8 },
})
