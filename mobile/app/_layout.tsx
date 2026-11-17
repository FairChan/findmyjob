import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ToastProvider } from '@/components/ui'
import { HumanCheckProvider } from '@/features/auth/human-check'
import { PreferencesProvider } from '@/features/settings/prefs'
import { onAppEvent } from '@/lib/app-events'
import { authClient } from '@/lib/auth-client'
import { bindOnlineManager } from '@/lib/online'
import { createQueryClient } from '@/lib/query-client'
import { useTheme } from '@/theme/use-theme'

// 离线时查询暂停、缓存照常显示，恢复联网后自动续上（MOBILE.md §5.5 离线）
bindOnlineManager()

/** API 层的全局事件 → 页面跳转；退出登录时清空所有缓存（MOBILE.md §6 本地存储） */
function AppEventBridge() {
  const router = useRouter()
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onAppEvent((event) => {
        if (event === 'signed-out') {
          queryClient.clear()
          void authClient.signOut().catch(() => {})
          router.replace('/welcome')
        } else if (event === 'needs-reconsent') {
          router.push('/status/reconsent')
        } else if (event === 'update-required') {
          router.replace('/status/update')
        }
      }),
    [router, queryClient],
  )
  return null
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient)
  return (
    <PreferencesProvider>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <HumanCheckProvider>
              <ThemedStack />
            </HumanCheckProvider>
          </ToastProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </PreferencesProvider>
  )
}

/** 放在 PreferencesProvider 里面：设置页切换深浅色后，状态栏和页面底色立即跟着变 */
function ThemedStack() {
  const { colors, scheme } = useTheme()
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <AppEventBridge />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  )
}
