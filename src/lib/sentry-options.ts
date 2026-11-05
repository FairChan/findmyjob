import type { NodeOptions } from '@sentry/node'
import type { ErrorEvent, EventHint, Breadcrumb, BreadcrumbHint } from '@sentry/node'
import { redact } from './redact'

// PII field names from logger.ts redact paths (top-level keys only)
const PII_KEYS = new Set([
  'password', 'token', 'email', 'phone', 'whatsapp', 'wechat', 'linkedin', 'cookie', 'authorization',
])

function urlToPathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    const qi = url.indexOf('?')
    return qi !== -1 ? url.slice(0, qi) : url
  }
}

// Matches pure digits, UUID v4, cuid/cuid2 (alphanum ≥20 chars), long tokens (≥20 chars)
const LIKELY_ID = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9]{20,})$/i

function sanitizePath(path: string): string {
  return path
    .split('/')
    .map((seg) => (LIKELY_ID.test(seg) ? '[id]' : seg))
    .join('/')
}

function scrubExtra(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (PII_KEYS.has(k)) continue
    if (typeof v === 'string') {
      result[k] = redact(v)
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = scrubExtra(v as Record<string, unknown>)
    } else {
      result[k] = v
    }
  }
  return result
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
      scrubbed.url = sanitizePath(urlToPathname(url))
    }

    event = { ...event, request: scrubbed }
  }

  // Strip query string (and sanitize IDs) from Next.js route context
  if (event.contexts?.nextjs) {
    const nextjs = { ...(event.contexts.nextjs as Record<string, unknown>) }
    if (typeof nextjs['request_path'] === 'string') {
      nextjs['request_path'] = sanitizePath(urlToPathname(nextjs['request_path']))
    }
    event = { ...event, contexts: { ...event.contexts, nextjs } }
  }

  // Redact PII from exception message text
  if (event.exception?.values) {
    event = {
      ...event,
      exception: {
        ...event.exception,
        values: event.exception.values.map((ex) => ({
          ...ex,
          value: ex.value !== undefined ? redact(ex.value) : ex.value,
        })),
      },
    }
  }

  // Remove PII keys and redact string values in extra
  if (event.extra) {
    event = { ...event, extra: scrubExtra(event.extra as Record<string, unknown>) }
  }

  // Remove user field (may contain PII)
  const { user: _u, ...restEvent } = event
  event = restEvent as ErrorEvent

  if (event.message) {
    event = { ...event, message: redact(event.message) }
  }

  return event
}

export function beforeBreadcrumb(breadcrumb: Breadcrumb, _hint?: BreadcrumbHint): Breadcrumb | null {
  if (breadcrumb.type === 'http' || breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
    const data = breadcrumb.data ? { ...breadcrumb.data } : {}
    if (typeof data['url'] === 'string') {
      data['url'] = sanitizePath(urlToPathname(data['url']))
    }
    delete data['http.query']
    breadcrumb = { ...breadcrumb, data }
  }

  if (breadcrumb.category === 'navigation') {
    const data = breadcrumb.data ? { ...breadcrumb.data } : {}
    if (typeof data['from'] === 'string') data['from'] = urlToPathname(data['from'])
    if (typeof data['to'] === 'string') data['to'] = urlToPathname(data['to'])
    delete data['http.query']
    breadcrumb = { ...breadcrumb, data }
  }

  if (breadcrumb.category === 'console') {
    if (typeof breadcrumb.message === 'string') {
      breadcrumb = { ...breadcrumb, message: redact(breadcrumb.message) }
    }
  }

  return breadcrumb
}

export const sentryOptions = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  tracesSampler: () => 0,
  beforeSendTransaction: () => null,
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.APP_ENV ?? 'development',
  release: process.env.APP_TAG,
  beforeSend: scrubEvent,
  beforeBreadcrumb,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
    httpBodies: [] as Array<'incomingRequest' | 'outgoingRequest' | 'incomingResponse' | 'outgoingResponse'>,
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  },
// sendDefaultPii was removed from NodeOptions in Sentry v11 (replaced by dataCollection);
// CLAUDE.md requires the field to remain explicit, so we extend the type to accept it.
} satisfies NodeOptions & { sendDefaultPii?: boolean }
