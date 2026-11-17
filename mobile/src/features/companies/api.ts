import { COMPANY_TAGS, mobileCompanyDetailSchema, mobileCompanyPageSchema } from '@shared/mobile-api'
import { useInfiniteQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'

export type CompanyTag = (typeof COMPANY_TAGS)[number]
export { COMPANY_TAGS }

function qs(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

export function useCompanies(tag: CompanyTag | null) {
  return useInfiniteQuery({
    queryKey: qk.companies(tag),
    queryFn: ({ pageParam, signal }) => apiFetch(`/companies${qs({ tag: tag ?? undefined, cursor: pageParam })}`, { schema: mobileCompanyPageSchema, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/** 企业主页：介绍 + 在招职位（职位另有游标 jobsCursor）；点职位进预览，不扣额度 */
export function useCompany(id: string) {
  return useInfiniteQuery({
    queryKey: qk.company(id),
    queryFn: ({ pageParam, signal }) => apiFetch(`/companies/${id}${qs({ jobsCursor: pageParam })}`, { schema: mobileCompanyDetailSchema, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.jobs.nextCursor ?? undefined,
  })
}

/** 网址只接受 http(s)（服务端已过滤，这里再兜一层，免得打开奇怪的 scheme） */
export function safeWebsite(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null
}
