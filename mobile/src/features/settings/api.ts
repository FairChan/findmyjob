import { mobileLocaleResultSchema, mobileNotificationPrefsSchema } from '@shared/mobile-api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import type { AppLocale } from '@/i18n/messages'

const PREFS_KEY = ['notification-prefs'] as const

// PATCH /me/locale（MA1-T05）：邮件和推送的语言跟着服务端的 User.locale 走
export function patchLocale(locale: AppLocale) {
  return apiFetch('/me/locale', { method: 'PATCH', body: { locale }, schema: mobileLocaleResultSchema })
}

export function useNotificationPrefs() {
  return useQuery({ queryKey: PREFS_KEY, queryFn: ({ signal }) => apiFetch('/me/notification-prefs', { schema: mobileNotificationPrefsSchema, signal }) })
}

/**
 * PUT /me/notification-prefs：开启周报要原样回传当前条款版本（服务端写 MARKETING 同意和审计），
 * 关闭只需 { granted: false }。
 */
export function useSetWeeklyDigest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { granted: true; submittedVersion: string } | { granted: false }) =>
      apiFetch('/me/notification-prefs', { method: 'PUT', body: input, schema: mobileNotificationPrefsSchema }),
    onSuccess: (data) => queryClient.setQueryData(PREFS_KEY, data),
  })
}
