import Constants from 'expo-constants'
import { MOBILE_API_PREFIX } from '@shared/mobile-api'

type Extra = { apiBaseUrl?: string; variant?: string }

export function apiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as Extra | undefined
  return (extra?.apiBaseUrl ?? 'http://10.0.2.2:3000').replace(/\/+$/, '')
}

/** 拼出移动端 API 的完整地址；path 以 / 开头，如 /me */
export function mobileApiUrl(path: string): string {
  return `${apiBaseUrl()}${MOBILE_API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
}

export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0'
}
