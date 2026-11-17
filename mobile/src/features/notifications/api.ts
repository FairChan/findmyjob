import { mobileEmptySchema, mobileNotificationPageSchema } from '@shared/mobile-api'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: qk.notifications,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(pageParam ? `/notifications?cursor=${encodeURIComponent(pageParam)}` : '/notifications', { schema: mobileNotificationPageSchema, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/** 未读数取第一页的 unreadCount（服务端按全部通知计算，不只是这一页） */
export function useUnreadCount(): number {
  const q = useNotifications()
  return q.data?.pages[0]?.unreadCount ?? 0
}

// MA1-T05：POST /notifications/read，body 是 { ids }（最多 50 个）或 { all: true }
export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { ids: string[] } | { all: true }) => apiFetch('/notifications/read', { method: 'POST', body: input, schema: mobileEmptySchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  })
}

/** 通知类型 → 文案 key（复用 Web 通知页的 notifications.*；与 src/app/[locale]/s/notifications 的映射一致） */
const TYPE_KEYS: Record<string, string> = {
  'talent.unlock': 'talentUnlock',
  'company.verified': 'companyVerified',
  'company.rejected': 'companyRejected',
  'job.approved': 'jobApproved',
  'job.rejected': 'jobRejected',
  'application.status.changed': 'applicationStatusChanged',
  'invitation.received': 'invitationReceived',
  'invitation.accepted': 'invitationAccepted',
  'invitation.declined': 'invitationDeclined',
  'credits.granted': 'creditsGranted',
  'credits.low': 'creditsLow',
  'quota.exhausted': 'quotaExhausted',
  'referral.qualified': 'referralQualified',
  'system.alert': 'systemAlert',
}

export function notificationKey(type: string): string {
  return TYPE_KEYS[type] ?? 'unknownType'
}

/** 点通知跳到哪：只按类型决定（通知不带 payload），去对应的列表页 */
export function notificationTarget(type: string): string | null {
  if (type.startsWith('application.')) return '/applications'
  if (type === 'invitation.received') return '/applications?tab=invitations'
  if (type === 'talent.unlock') return '/privacy'
  if (type === 'quota.exhausted' || type === 'referral.qualified') return '/invite'
  return null
}
