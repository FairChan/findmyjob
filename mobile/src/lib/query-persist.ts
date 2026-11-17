import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { Query, QueryClient } from '@tanstack/react-query'

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
  try {
    await queryPersister.removeClient()
  } catch {
    // 删不掉也继续删下面的键
  }
  await AsyncStorage.removeItem(PERSIST_STORAGE_KEY).catch(() => {})
}

/**
 * 先清内存再删磁盘：持久化写入有 2 秒节流，若先删磁盘，排队中的旧状态可能再被写回去。
 * clear() 之后排队的是空状态，随后的 removeClient 把它也删掉。
 */
export async function resetAllCaches(queryClient: QueryClient): Promise<void> {
  queryClient.clear()
  await clearPersistedQueries()
}

const OWNER_KEY = 'findmyjob-query-cache-owner'

/**
 * 磁盘缓存属于哪个账号：登录后的第一次 /me 结果和记录不一致（上一个账号退出时没清干净，
 * 例如退出途中 App 被杀），就整个丢掉，绝不把 A 的投递、通知显示给 B。
 */
export async function ensureCacheOwner(queryClient: QueryClient, userId: string): Promise<boolean> {
  const owner = await AsyncStorage.getItem(OWNER_KEY).catch(() => null)
  const mismatch = owner !== null && owner !== userId
  if (mismatch) {
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    await clearPersistedQueries()
  }
  if (owner !== userId) await AsyncStorage.setItem(OWNER_KEY, userId).catch(() => {})
  return mismatch
}
