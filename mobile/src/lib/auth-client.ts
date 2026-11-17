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
