import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '@/theme/use-theme'

type Tone = 'info' | 'error'
type ToastState = { id: number; message: string; tone: Tone } | null

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null)
  const seq = useRef(0)
  const show = useCallback((message: string, tone: Tone = 'info') => {
    seq.current += 1
    setToast({ id: seq.current, message, tone })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? <ToastView message={toast.message} tone={toast.tone} /> : null}
    </ToastContext.Provider>
  )
}

function ToastView({ message, tone }: { message: string; tone: Tone }) {
  const { colors, radius } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 24 }]}>
      <View
        accessible
        accessibilityLiveRegion="assertive"
        accessibilityRole="alert"
        style={[styles.toast, { borderRadius: radius.button, backgroundColor: tone === 'error' ? colors.destructive : colors.foreground }]}
      >
        <Text style={[styles.text, { color: colors.background }]}>{message}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: { paddingHorizontal: 16, paddingVertical: 12, maxWidth: 480 },
  text: { fontSize: 15, lineHeight: 20 },
})
