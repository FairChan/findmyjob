import 'server-only'
import { APP_ORIGIN_HEADER } from '@/shared/mobile-api'

// 只接受形如 "findmyjob://" 的自定义 scheme origin；http(s)、javascript、exp 一律丢弃，
// 防止有人把网页 origin 配进 App 白名单、借此绕过 Web 的 Origin 校验。
const APP_ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/$/
const BLOCKED_SCHEMES = new Set(['http://', 'https://', 'javascript://', 'data://', 'file://', 'exp://'])

export function parseAppOrigins(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => APP_ORIGIN_RE.test(s) && !BLOCKED_SCHEMES.has(s))
}

export function configuredAppOrigins(): string[] {
  return parseAppOrigins(typeof process === 'undefined' ? undefined : process.env.MOBILE_APP_ORIGINS)
}

/**
 * 请求声称的来源：有 Origin 就只看 Origin（浏览器总会带，而且不能伪造）；
 * 没有 Origin 时才看 expo-origin（@better-auth/expo 的客户端用它传 App scheme）。
 */
export function requestAppOrigin(headers: Headers): string | null {
  return headers.get('origin') ?? headers.get(APP_ORIGIN_HEADER)
}

export function isAppOriginRequest(headers: Headers): boolean {
  const origin = requestAppOrigin(headers)
  return origin !== null && configuredAppOrigins().includes(origin)
}
