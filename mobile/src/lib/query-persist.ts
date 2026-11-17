import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { Query } from '@tanstack/react-query'

/**
 * 离线缓存（MA3-T05）：只把"重新打开 App 时值得秒开"的公共或低敏数据落盘。
 * 白名单之外的一律只在内存里：me、档案、隐私、简历、邀请同学（有被邀请人名字）、
 * 职位完整详情 jobOpen（含简历文件名）都不落盘。退出登录时 queryClient.clear() + persister 清空。
 */
export const PERSISTED_ROOTS = ['jobs', 'companies', 'company', 'applications', 'invitations', 'notifications'] as const

export const PERSIST_STORAGE_KEY = 'findmyjob-query-cache-v1'

// 一周前的缓存没有意义，还可能停留在已下线的职位上
export const PERSIST_MAX_AGE_MS = 7 * 24 * 3600_000

export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  const root = query.queryKey[0]
  return typeof root === 'string' && (PERSISTED_ROOTS as readonly string[]).includes(root) && query.state.status === 'success'
}

export const queryPersister = createAsyncStoragePersister({ storage: AsyncStorage, key: PERSIST_STORAGE_KEY, throttleTime: 2000 })

/** 退出登录、注销账号时调用：磁盘上的缓存也要清掉 */
export async function clearPersistedQueries(): Promise<void> {
  await AsyncStorage.removeItem(PERSIST_STORAGE_KEY).catch(() => {})
}
