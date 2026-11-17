import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ToastProvider } from '@/components/ui'
import { HumanCheckProvider } from '@/features/auth/human-check'
import { AppIntlProvider, deviceLocale } from '@/i18n/provider'
import { onAppEvent } from '@/lib/app-events'
import { authClient } from '@/lib/auth-client'
import { createQueryClient } from '@/lib/query-client'
import { useTheme } from '@/theme/use-theme'

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
  const { colors } = useTheme()
  return (
    <AppIntlProvider locale={deviceLocale()}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <HumanCheckProvider>
              <StatusBar style="auto" />
              <AppEventBridge />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
            </HumanCheckProvider>
          </ToastProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </AppIntlProvider>
  )
}
