import { expoClient } from '@better-auth/expo/client'
import { createAuthClient } from 'better-auth/react'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'

import { apiBaseUrl } from './api-config'

// 会话方案见 MA0-T04：Better Auth 的 Cookie 存在 SecureStore（Android Keystore 加密），
// 每个请求手动带 cookie 和 expo-origin，fetch 一律 credentials: 'omit'。
export const AUTH_STORAGE_PREFIX = 'findmyjob'

function appScheme(): string {
  const raw = Constants.expoConfig?.scheme
  const scheme = Array.isArray(raw) ? raw[0] : raw
  return scheme ?? 'findmyjob-dev'
}

export const authClient = createAuthClient({
  baseURL: apiBaseUrl(),
  plugins: [
    expoClient({
      scheme: appScheme(),
      storagePrefix: AUTH_STORAGE_PREFIX,
      storage: SecureStore,
    }),
  ],
})

/** 当前保存的 Cookie 串，供 /api/m/v1 的请求带上 */
export async function sessionCookie(): Promise<string> {
  return (await authClient.getCookie()) ?? ''
}

export function appOrigin(): string {
  return `${appScheme()}://`
}

/**
 * 退出登录时无条件清掉本机凭据（fail-closed）：服务端 /sign-out 失败（离线、5xx、会话已被吊销）时，
 * 不能让 Cookie 继续留在 SecureStore 里。@better-auth/expo 的值可能被拆成多个分片键
 * （基键里存 "ba-chunks:<数量>[:<槽位>[:<旧数量>]]"），分片也一起删。
 */
export async function clearLocalSession(): Promise<void> {
  for (const key of [`${AUTH_STORAGE_PREFIX}_cookie`, `${AUTH_STORAGE_PREFIX}_session_data`]) {
    let base: string | null = null
    try {
      base = await SecureStore.getItemAsync(key)
    } catch {
      base = null
    }
    if (base?.startsWith('ba-chunks:')) {
      const max = Math.min(Math.max(0, ...(base.slice('ba-chunks:'.length).match(/\d+/g) ?? []).map(Number)), 100)
      for (let i = 0; i < max; i++) {
        for (const chunk of [`${key}.${i}`, `${key}.0.${i}`, `${key}.1.${i}`]) await SecureStore.deleteItemAsync(chunk).catch(() => {})
      }
    }
    await SecureStore.deleteItemAsync(key).catch(() => {})
  }
  // 让 useSession 立即变成未登录（会话原子按信号重新读取，此时已经没有 Cookie）
  try {
    authClient.$store.notify('$sessionSignal')
  } catch {
    // 只影响界面刷新时机，凭据已经删了
  }
}
