import type { ErrorEvent, EventHint } from '@sentry/node'
import { redact } from './redact'

function urlToPathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    const qi = url.indexOf('?')
    return qi !== -1 ? url.slice(0, qi) : url
  }
}

export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  if (event.request) {
    const { cookies: _c, data: _d, query_string: _q, headers, url, ...restReq } = event.request
    const scrubbed: typeof event.request = { ...restReq }

    if (headers) {
      const h = headers as Record<string, string>
      const ua = h['User-Agent'] ?? h['user-agent']
      scrubbed.headers = ua ? { 'User-Agent': ua } : {}
    }

    if (url) {
      scrubbed.url = urlToPathname(url)
    }

    event = { ...event, request: scrubbed }
  }

  // Remove user field (may contain PII)
  const { user: _u, ...restEvent } = event
  event = restEvent as ErrorEvent

  if (event.message) {
    event = { ...event, message: redact(event.message) }
  }

  return event
}

export const sentryOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.APP_ENV ?? 'development',
  release: process.env.APP_TAG,
  beforeSend: scrubEvent,
}
