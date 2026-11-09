import type { AppEnv } from '@/env'

export function buildContentSecurityPolicy({ nonce, appEnv, sentryDsn }: {
  nonce: string
  appEnv: AppEnv
  sentryDsn?: string
}): string {
  const connectSources = ["'self'", 'https://challenges.cloudflare.com']
  if (sentryDsn) {
    try {
      const url = new URL(sentryDsn)
      if (url.protocol === 'https:' || url.protocol === 'http:') connectSources.push(url.origin)
    } catch {
      // An invalid optional reporting destination must not broaden the policy.
    }
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${appEnv === 'production' ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${[...new Set(connectSources)].join(' ')}`,
    'frame-src https://challenges.cloudflare.com',
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    'report-uri /api/csp-report',
  ].join('; ')
}
