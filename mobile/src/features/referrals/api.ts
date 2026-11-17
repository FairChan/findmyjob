import { mobileReferralsSchema } from '@shared/mobile-api'
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'

/** 邀请码、解锁进度和本月额度（只读，不扣额度；首页额度卡片也用它） */
export function useReferrals() {
  return useQuery({ queryKey: qk.referrals, queryFn: ({ signal }) => apiFetch('/referrals/me', { schema: mobileReferralsSchema, signal }) })
}
