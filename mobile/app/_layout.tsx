import { useQueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ToastProvider } from '@/components/ui'
import { signOut } from '@/features/auth/actions'
import { HumanCheckProvider } from '@/features/auth/human-check'
import { PushBridge } from '@/features/push/push-bridge'
import { PreferencesProvider } from '@/features/settings/prefs'
import { appVersion } from '@/lib/api-config'
import { onAppEvent } from '@/lib/app-events'
import { bindOnlineManager } from '@/lib/online'
import { createQueryClient } from '@/lib/query-client'
import { PERSIST_MAX_AGE_MS, queryPersister, shouldPersistQuery } from '@/lib/query-persist'
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
          // 会话失效或注销账号后：本机凭据必清（signOut 内部 finally），再清缓存回欢迎页
          void signOut().finally(() => {
            queryClient.clear()
            router.replace('/welcome')
          })
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
        <PersistQueryClientProvider
          client={queryClient}
          // 离线缓存只落白名单里的查询（MA3-T05）；换版本号时整体作废，避免旧结构的缓存
          persistOptions={{ persister: queryPersister, maxAge: PERSIST_MAX_AGE_MS, buster: appVersion(), dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery } }}
        >
          <ToastProvider>
            <HumanCheckProvider>
              <ThemedStack />
            </HumanCheckProvider>
          </ToastProvider>
        </PersistQueryClientProvider>
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
      <PushBridge />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  )
}
