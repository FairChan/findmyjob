'use client'

import { useLocale, useTranslations } from 'next-intl'

export function PlanActionError({ code, operation, id }: {
  code: string
  operation: 'create' | 'update' | 'delete'
  id: string
}) {
  const t = useTranslations('adminPlans')
  const locale = useLocale()
  if (!code) return null

  const key = code === 'CONFLICT'
    ? operation === 'create' ? 'errorDuplicate' : operation === 'update' ? 'errorStale' : 'errorReferenced'
    : code === 'VALIDATION_ERROR' ? 'errorInvalid'
      : code === 'NOT_FOUND' ? 'errorNotFound'
        : code === 'TWO_FACTOR_REQUIRED' ? 'errorTwoFactor'
          : ['FORBIDDEN', 'FRESH_SESSION_REQUIRED'].includes(code) ? 'errorForbidden'
            : 'errorGeneric'
  const needsAuth = ['FORBIDDEN', 'FRESH_SESSION_REQUIRED', 'TWO_FACTOR_REQUIRED'].includes(code)

  return (
    <div className="space-y-2">
      <p id={id} role="alert" className="text-sm text-destructive">{t(key)}</p>
      {needsAuth && <a className="inline-flex min-h-10 items-center text-sm text-brand underline underline-offset-2" href={'/' + locale + (code === 'TWO_FACTOR_REQUIRED' ? '/two-factor/setup' : '/login')}>
        {t(code === 'TWO_FACTOR_REQUIRED' ? 'setupTwoFactor' : 'signIn')}
      </a>}
    </div>
  )
}
