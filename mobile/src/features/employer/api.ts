import {
  mobileApplicantDetailSchema,
  mobileApplicantListSchema,
  mobileCompanyInvitationListSchema,
  mobileEmployerJobListSchema,
  mobileEmployerJobStatusSchema,
  mobileEmptySchema,
  mobileSendInvitationResultSchema,
  mobileTalentPageSchema,
  mobileTalentQuerySchema,
  mobileTalentViewSchema,
  mobileUnlockResultSchema,
  mobileWalletSchema,
  type MobileApplicantDetail,
  type MobileApplicantList,
  type MobileTalentPage,
  type MobileTalentQuery,
  type MobileTalentView,
} from '@shared/mobile-api'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'

// 企业端的查询 key 一律以 'e' 开头：不在离线缓存白名单（query-persist 的 PERSISTED_ROOTS）里，
// 候选人数据只放内存，退出登录即清空。
export const ek = {
  all: ['e'] as const,
  wallet: ['e', 'wallet'] as const,
  jobs: ['e', 'jobs'] as const,
  applicants: (jobId: string) => ['e', 'applicants', jobId] as const,
  applicant: (id: string) => ['e', 'applicant', id] as const,
  invitations: ['e', 'invitations'] as const,
  talentSearch: ['e', 'talentSearch'] as const,
  talentView: (id: string) => ['e', 'talentView', id] as const,
}

// ---------- 不计数的读接口：正常缓存、下拉刷新 ----------

export function useWallet() {
  return useQuery({ queryKey: ek.wallet, queryFn: ({ signal }) => apiFetch('/e/wallet', { schema: mobileWalletSchema, signal }) })
}

export function useEmployerJobs() {
  return useQuery({ queryKey: ek.jobs, queryFn: ({ signal }) => apiFetch('/e/jobs', { schema: mobileEmployerJobListSchema, signal }) })
}

export function useApplicants(jobId: string) {
  return useQuery({ queryKey: ek.applicants(jobId), queryFn: ({ signal }) => apiFetch(`/e/jobs/${jobId}/applicants`, { schema: mobileApplicantListSchema, signal }) })
}


export function useCompanyInvitations() {
  return useQuery({ queryKey: ek.invitations, queryFn: ({ signal }) => apiFetch('/e/invitations', { schema: mobileCompanyInvitationListSchema, signal }) })
}

// ---------- 写接口 ----------

/** 关闭职位（Web 没有暂停/恢复；重新上架要在网页版编辑后重新送审） */
export function useCloseJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => apiFetch(`/e/jobs/${jobId}/close`, { method: 'POST', schema: mobileEmployerJobStatusSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ek.jobs }),
  })
}

/** 企业可以设的状态（APPLIED/WITHDRAWN 只能由学生侧产生，服务端 422） */
export const SETTABLE_STATUSES = ['VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'] as const
export type SettableStatus = (typeof SETTABLE_STATUSES)[number]

export function useChangeStatus(applicationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { toStatus: SettableStatus; note: string | null }) =>
      apiFetch(`/e/applications/${applicationId}/status`, { method: 'POST', body: input, schema: mobileEmptySchema }),
    // 详情会计数，不能靠重取刷新：直接改缓存里的状态；列表不计数，正常失效重取
    onSuccess: (_r, { toStatus }) => setCachedApplicantStatus(queryClient, applicationId, toStatus),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['e', 'applicants'] }),
  })
}

function setCachedApplicantStatus(queryClient: QueryClient, applicationId: string, status: MobileApplicantDetail['status']) {
  queryClient.setQueryData<MobileApplicantDetail>(ek.applicant(applicationId), (old) => (old ? { ...old, status } : old))
}

/** 打开候选人详情时标记已查看（APPLIED → VIEWED，其余 no-op；与 Web 打开详情一致） */
export function useMarkViewed(applicationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/e/applications/${applicationId}/viewed`, { method: 'POST', schema: mobileEmptySchema }),
    onSuccess: () => {
      setCachedApplicantStatus(queryClient, applicationId, 'VIEWED')
      void queryClient.invalidateQueries({ queryKey: ['e', 'applicants'] })
    },
  })
}

export function useSendInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { studentId: string; jobId: string; message: string | null }) =>
      apiFetch('/e/invitations', { method: 'POST', body: input, schema: mobileSendInvitationResultSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ek.invitations }),
  })
}

// ---------- 会计数的接口：只能由用户点击触发 ----------
// 和学生端的 open 一样做成 mutation（TanStack 不会预取、聚焦重取或失效重取 mutation），
// 结果写进一个 enabled=false、queryFn 直接抛错的缓存项，供页面回退和详情页读取。

function cacheOnly<T>(key: readonly unknown[]) {
  return {
    queryKey: key,
    queryFn: (): T => {
      throw new Error('counted endpoint: written only after a user tap')
    },
    enabled: false,
    staleTime: Infinity,
    retry: false,
  } as const
}

export type TalentFilters = Omit<MobileTalentQuery, 'cursor'>

/** 拼 /e/talent 的查询串；先过共享 strict schema，拼错了在本地就报出来，不浪费一次计数 */
export function talentPath(filters: TalentFilters, cursor?: string): string {
  const parsed = mobileTalentQuerySchema.parse({ ...filters, keyword: filters.keyword?.trim() || undefined, cursor })
  const params = Object.entries(parsed)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return params.length ? `/e/talent?${params.join('&')}` : '/e/talent'
}

export type TalentSearchState = { filters: TalentFilters; pages: MobileTalentPage[] }

export function useTalentSearchResults() {
  return useQuery<TalentSearchState>(cacheOnly<TalentSearchState>(ek.talentSearch))
}

/** 每次调用 = 计一页（limits.searchPagesPerDay）。cursor 为空表示新搜索，结果替换；有 cursor 是"下一页"，追加 */
export function useTalentSearch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ filters, cursor }: { filters: TalentFilters; cursor?: string }) =>
      apiFetch(talentPath(filters, cursor), { schema: mobileTalentPageSchema, userInitiated: true }),
    onSuccess: (page, { filters, cursor }) => {
      queryClient.setQueryData<TalentSearchState>(ek.talentSearch, (old) => ({
        filters,
        pages: cursor && old ? [...old.pages, page] : [page],
      }))
    },
  })
}

export function useApplicantCache(id: string) {
  return useQuery<MobileApplicantDetail>(cacheOnly<MobileApplicantDetail>(ek.applicant(id)))
}

/**
 * 候选人详情（GET /e/applications/:id）和 Web 看板点开候选人一样走 viewTalentProfile：
 * 写 ProfileView、计每日查看上限，所以同样只在用户点击时调用。
 */
export function useViewApplicant(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/e/applications/${id}`, { schema: mobileApplicantDetailSchema, userInitiated: true }),
    onSuccess: (data) => queryClient.setQueryData(ek.applicant(id), data),
  })
}

/** 列表里已有的候选人卡片（不计数），详情未加载前先显示它 */
export function findApplicantCard(queryClient: QueryClient, applicationId: string): MobileApplicantList['items'][number] | undefined {
  for (const [, data] of queryClient.getQueriesData<MobileApplicantList>({ queryKey: ['e', 'applicants'] })) {
    const hit = data?.items.find((a) => a.applicationId === applicationId)
    if (hit) return hit
  }
  return undefined
}

export function useTalentViewCache(id: string) {
  return useQuery<MobileTalentView>(cacheOnly<MobileTalentView>(ek.talentView(id)))
}

/** 查看人才详情：写 ProfileView、计每日查看上限（同一学生当天只计一次） */
export function useViewTalent(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/e/talent/${id}`, { schema: mobileTalentViewSchema, userInitiated: true }),
    onSuccess: (data) => queryClient.setQueryData(ek.talentView(id), data),
  })
}

/**
 * 解锁：CREDIT 扣点（已解锁不重复扣），失败不自动重试（mutations.retry=false）。
 * 成功后余额用服务端返回值；联系方式只在重新读一次详情后才有——这次读取属于同一个用户动作，
 * 而且当天已经计过这名学生，不会再占一次查看名额。
 */
export function useUnlock(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/e/talent/${id}/unlock`, { method: 'POST', schema: mobileUnlockResultSchema, userInitiated: true })
      // 点数已经扣了：重读详情失败也不能把解锁当成失败（否则用户会以为没解锁、再点一次）
      const view = await apiFetch(`/e/talent/${id}`, { schema: mobileTalentViewSchema, userInitiated: true }).catch(() => null)
      return { res, view }
    },
    onSuccess: ({ res, view }) => {
      if (view) queryClient.setQueryData(ek.talentView(id), view)
      if (res.balance !== null) queryClient.setQueryData(ek.wallet, { balance: res.balance })
      void queryClient.invalidateQueries({ queryKey: ek.wallet })
    },
  })
}
