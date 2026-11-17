import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '@/theme/use-theme'

/** 底部抽屉（筛选、确认）；系统返回键和点背景都会关闭 */
export function Sheet({ open, onClose, title, children, closeLabel }: {
  open: boolean
  onClose: () => void
  title: string
  closeLabel: string
  children: ReactNode
}) {
  const { colors, radius } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} />
        <View
          accessibilityViewIsModal
          style={[
            styles.panel,
            { backgroundColor: colors.background, borderTopLeftRadius: radius.card * 1.5, borderTopRightRadius: radius.card * 1.5, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {title}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: { paddingHorizontal: 16, paddingTop: 8, gap: 12, maxHeight: '85%' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 4 },
  title: { fontSize: 18, fontWeight: '600' },
})
