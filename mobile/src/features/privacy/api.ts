import { mobileCompanySearchSchema, mobileDataExportSchema, mobileEmptySchema, mobilePrivacySchema } from '@shared/mobile-api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'

// 隐私中心的端点都在 MA1-T05：/privacy、/privacy/companies、/privacy/blocked-companies、
// /data-requests/export、/account/delete（与 Web /s/privacy 同一组 service，全部豁免重新同意）

export function usePrivacy() {
  return useQuery({ queryKey: qk.privacy, queryFn: ({ signal }) => apiFetch('/privacy', { schema: mobilePrivacySchema, signal }) })
}

export function useSetVisibility() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (granted: boolean) => apiFetch('/privacy', { method: 'PUT', body: { granted }, schema: mobileEmptySchema }),
    onSettled: () => Promise.all([queryClient.invalidateQueries({ queryKey: qk.privacy }), queryClient.invalidateQueries({ queryKey: qk.completeness })]),
  })
}

/** 屏蔽前按名称搜认证企业；至少 1 个字符才查（服务端 min(1)） */
export function useCompanySearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: qk.blockSearch(q),
    queryFn: ({ signal }) => apiFetch(`/privacy/companies?query=${encodeURIComponent(q)}`, { schema: mobileCompanySearchSchema, signal }),
    enabled: q.length > 0,
  })
}

export function useBlockCompany() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, block }: { companyId: string; block: boolean }) =>
      block
        ? apiFetch('/privacy/blocked-companies', { method: 'POST', body: { companyId }, schema: mobileEmptySchema })
        : apiFetch(`/privacy/blocked-companies/${companyId}`, { method: 'DELETE', schema: mobileEmptySchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.privacy }),
  })
}

export function useRequestExport() {
  return useMutation({ mutationFn: () => apiFetch('/data-requests/export', { method: 'POST', body: {}, schema: mobileDataExportSchema }) })
}

/** 注销不可逆：服务端要求显式 confirm=true；成功后会话已被服务端吊销，App 清空本地会话和缓存 */
export function deleteAccount() {
  return apiFetch('/account/delete', { method: 'POST', body: { confirm: true }, schema: mobileEmptySchema })
}
