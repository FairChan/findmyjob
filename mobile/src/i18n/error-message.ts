import { useCallback } from 'react'
import { useTranslations } from 'use-intl'

import { MESSAGES } from './messages'
import { ApiError } from '@/lib/api-client'

const KNOWN = new Set(Object.keys(MESSAGES.zh.mobile.errors))

/** 错误码 → 文案 key；不认识的一律用通用文案，绝不把服务端原文显示给用户 */
export function errorMessageKey(err: unknown): string {
  const code = err instanceof ApiError ? err.code : typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : ''
  return code && KNOWN.has(code) && code !== 'generic' ? code : 'generic'
}

export function useErrorMessage(): (err: unknown) => string {
  const t = useTranslations('mobile.errors')
  return useCallback((err: unknown) => t(errorMessageKey(err) as 'generic'), [t])
}
