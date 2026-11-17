import {
  mobileApplicationListSchema,
  mobileApplicationRefSchema,
  mobileApplicationTimelineSchema,
  mobileEmptySchema,
  mobileInvitationListSchema,
  type MobileJobOpen,
} from '@shared/mobile-api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'

export function useApplications() {
  return useQuery({ queryKey: qk.applications, queryFn: ({ signal }) => apiFetch('/applications', { schema: mobileApplicationListSchema, signal }) })
}

export function useTimeline(id: string) {
  return useQuery({
    queryKey: qk.timeline(id),
    queryFn: ({ signal }) => apiFetch(`/applications/${id}/timeline`, { schema: mobileApplicationTimelineSchema, signal }),
  })
}

export function useInvitations() {
  return useQuery({ queryKey: qk.invitations, queryFn: ({ signal }) => apiFetch('/invitations', { schema: mobileInvitationListSchema, signal }) })
}

/** 已结束：录用、被拒、已撤回；其余都算进行中 */
export const CLOSED_STATUSES = new Set(['HIRED', 'REJECTED', 'WITHDRAWN'])

/**
 * POST /applications（MA1-T05）。投递必须在线确认，不做离线排队；写操作不自动重试（query-client）。
 * 成功后把 jobOpen 缓存里的 application 补上，详情页回来就显示"已投递"，不需要再调 open。
 */
export function useApply(jobId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { resumeId: string | null; coverNote: string | null }) =>
      apiFetch('/applications', { method: 'POST', body: { jobId, resumeId: input.resumeId, coverNote: input.coverNote }, schema: mobileApplicationRefSchema }),
    onSuccess: async ({ applicationId }) => {
      queryClient.setQueryData<MobileJobOpen>(qk.jobOpen(jobId), (old) =>
        old ? { ...old, application: { id: applicationId, status: 'APPLIED', canWithdraw: true } } : old,
      )
      await queryClient.invalidateQueries({ queryKey: qk.applications })
    },
  })
}

// POST /applications/:id/withdraw（MA1-T05，幂等）
export function useWithdraw(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/applications/${id}/withdraw`, { method: 'POST', schema: mobileEmptySchema }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.applications })
    },
  })
}

// POST /invitations/:id/accept | decline（MA1-T05）。接受 = 投递该职位，不扣查看额度
export function useRespondInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'accept' | 'decline' }): Promise<{ applicationId: string | null }> => {
      if (action === 'accept') return apiFetch(`/invitations/${id}/accept`, { method: 'POST', schema: mobileApplicationRefSchema })
      await apiFetch(`/invitations/${id}/decline`, { method: 'POST', schema: mobileEmptySchema })
      return { applicationId: null }
    },
    onSettled: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: qk.invitations }), queryClient.invalidateQueries({ queryKey: qk.applications })])
    },
  })
}
