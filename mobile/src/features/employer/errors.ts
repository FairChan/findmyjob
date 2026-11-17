import { useCallback } from 'react'
import { useTranslations } from 'use-intl'

import { useErrorMessage } from '@/i18n/error-message'
import { ApiError } from '@/lib/api-client'

export type EmployerAction = 'search' | 'view' | 'unlock' | 'invite' | 'status' | 'general'

/**
 * 企业端错误码在不同动作下含义不同（同一个 429 可能是翻页上限、查看上限或邀请额度），
 * 按动作换成对应文案；不认识的交给通用映射。点数不足只说明原因，App 里不出现任何购买入口。
 */
export function useEmployerError(): (err: unknown, action: EmployerAction) => string {
  const t = useTranslations('mobile.employer.errors')
  const generic = useErrorMessage()
  return useCallback(
    (err: unknown, action: EmployerAction) => {
      const code = err instanceof ApiError ? err.code : ''
      const status = err instanceof ApiError ? err.status : 0
      if (code === 'INSUFFICIENT_CREDITS' || status === 402) return t('insufficientCredits')
      if (code === 'RATE_LIMITED' || code === 'INVITATION_QUOTA_EXCEEDED' || status === 429) {
        return { search: t('searchLimit'), view: t('viewLimit'), unlock: t('unlockLimit'), invite: t('inviteQuota'), status: t('tooFast'), general: t('tooFast') }[action]
      }
      if (action === 'search' && (code === 'VALIDATION_ERROR' || status === 422)) return t('pageCap')
      if (action === 'status' && status === 422) return t('statusNotAllowed')
      if (code === 'FORBIDDEN' && action !== 'general') return t('verifyRequired')
      if (code === 'FEATURE_DISABLED') return t('featureDisabled')
      return generic(err)
    },
    [t, generic],
  )
}
