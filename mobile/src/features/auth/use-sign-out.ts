import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useCallback } from 'react'

import { resetAllCaches } from '@/lib/query-persist'

import { signOut } from './actions'

/** 页面上的"退出登录"按钮：清本机凭据 → 清全部查询缓存（MOBILE.md §6 本地存储）→ 回欢迎页 */
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useCallback(async () => {
    await signOut()
    await resetAllCaches(queryClient)
    router.replace('/welcome')
  }, [queryClient, router])
}
