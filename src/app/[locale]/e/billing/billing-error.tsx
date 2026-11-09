'use client'

import { useLocale, useTranslations } from 'next-intl'

export function BillingError({ code, operation }: { code: string; operation: 'quote' | 'create' | 'upload' | 'attach' | 'cancel' }) {
  const t = useTranslations('billing')
  const locale = useLocale()
  if (!code) return null
  const auth = ['FORBIDDEN', 'FRESH_SESSION_REQUIRED', 'TWO_FACTOR_REQUIRED'].includes(code)
  const key = auth ? 'errorForbidden'
    : code === 'RATE_LIMITED' ? 'errorRateLimited'
      : code === 'NOT_FOUND' ? 'errorNotFound'
        : code === 'FILE_TOO_LARGE' ? 'errorFileTooLarge'
          : ['NO_FILE', 'INVALID_FILE_TYPE', 'INVALID_FILE_NAME', 'ENCRYPTED_PDF', 'TOO_MANY_PAGES', 'INVALID_PDF'].includes(code) ? 'errorFile'
            : code === 'FEATURE_DISABLED' ? operation === 'upload' ? 'errorUploadDisabled' : 'salesUnavailable'
              : code === 'CONFLICT' ? operation === 'create' || operation === 'quote' ? 'quoteChanged' : operation === 'cancel' ? 'errorCancelConflict' : 'errorProofConflict'
                : code === 'VALIDATION_ERROR' ? 'errorInvalid'
                  : operation === 'quote' ? 'errorQuote' : operation === 'create' ? 'errorCreate' : operation === 'upload' ? 'errorUpload' : operation === 'attach' ? 'errorAttach' : 'errorCancel'
  return <div className="space-y-2">
    <p role="alert" className="text-sm text-red-800">{t(key)}</p>
    {auth && <a href={'/' + locale + '/login'} className="inline-flex min-h-10 items-center text-sm text-blue-700 underline">{t('signIn')}</a>}
    {operation === 'create' && code !== 'CONFLICT' && <a href={'/' + locale + '/e/billing'} className="inline-flex min-h-10 items-center text-sm text-blue-700 underline">{t('backToOrders')}</a>}
  </div>
}
