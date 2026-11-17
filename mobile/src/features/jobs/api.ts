import {
  mobileJobOpenSchema,
  mobileJobPageSchema,
  mobileJobPreviewSchema,
  mobileJobsQuerySchema,
  type MobileJobOpen,
  type MobileJobsQuery,
  type MobileQuota,
} from '@shared/mobile-api'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'

export type JobFilters = Pick<MobileJobsQuery, 'q' | 'type' | 'state' | 'workMode' | 'sort'>

/** 拼 /jobs 的查询串；先过一遍共享 schema（服务端是 strict 的，拼错了宁可在本地就报出来） */
export function jobsPath(filters: JobFilters, cursor?: string): string {
  const parsed = mobileJobsQuerySchema.parse({ ...filters, q: filters.q?.trim() || undefined, cursor })
  const params = Object.entries(parsed)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return params.length ? `/jobs?${params.join('&')}` : '/jobs'
}

/** 职位列表：不扣额度，可以正常缓存、预取、下拉刷新 */
export function useJobs(filters: JobFilters) {
  return useInfiniteQuery({
    queryKey: qk.jobs(filters),
    queryFn: ({ pageParam, signal }) => apiFetch(jobsPath(filters, pageParam), { schema: mobileJobPageSchema, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 换关键词或筛选时先留着上一组结果，避免列表闪成骨架
    placeholderData: keepPreviousData,
  })
}

/** 预览：只有列表级字段，不产生 JobView、不扣额度 */
export function useJobPreview(id: string) {
  return useQuery({
    queryKey: qk.jobPreview(id),
    queryFn: ({ signal }) => apiFetch(`/jobs/${id}/preview`, { schema: mobileJobPreviewSchema, signal }),
  })
}

/**
 * 唯一会扣额度的调用（POST /jobs/:id/open）。
 * 刻意做成 mutation 而不是 query：TanStack 不会对 mutation 做预取、聚焦重取或失效重取；
 * 只有用户点了"查看完整详情"（必要时再点确认）才会调用它，失败也不自动重试（query-client 里 mutations.retry=false）。
 * 结果写进 jobOpen 缓存，供详情页回退、投递页读取——这个缓存项永远没有 queryFn，不可能被自动重取。
 */
export function useOpenJob(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/jobs/${id}/open`, { method: 'POST', schema: mobileJobOpenSchema, userInitiated: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.jobOpen(id), data)
      // 额度变了：首页额度卡片和预览上的"剩余 N 次"要更新（这些都是不扣额度的读接口）
      queryClient.setQueryData(qk.jobPreview(id), (old: unknown) =>
        old && typeof old === 'object' ? { ...(old as object), quota: data.quota, opensFree: data.allowed } : old,
      )
      void queryClient.invalidateQueries({ queryKey: qk.referrals })
    },
  })
}

export function cachedOpen(queryClient: QueryClient, id: string): MobileJobOpen | undefined {
  return queryClient.getQueryData<MobileJobOpen>(qk.jobOpen(id))
}

/**
 * 订阅 jobOpen 缓存（投递成功后会更新里面的 application）。enabled=false 且 queryFn 直接抛错：
 * 无论失效、重连还是 refetch，都不可能借这个 query 去调用 open 端点。
 */
export function useOpenedJob(id: string) {
  return useQuery<MobileJobOpen>({
    queryKey: qk.jobOpen(id),
    queryFn: () => {
      throw new Error('jobOpen is written only by a user tap')
    },
    enabled: false,
    staleTime: Infinity,
    retry: false,
  })
}

export function remaining(quota: MobileQuota): number | null {
  return quota.limit === null ? null : Math.max(quota.limit - quota.used, 0)
}

export function quotaExhausted(quota: MobileQuota): boolean {
  return quota.limit !== null && quota.used >= quota.limit
}
