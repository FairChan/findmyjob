import 'server-only'
import { z } from 'zod'
import { AppError, ForbiddenError } from './errors'
import { logger } from './lib/logger'

// Stub for M0; replaced with real Better Auth session validation in M1-T01.
async function getSessionUserId(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers')
    const jar = await cookies()
    void jar
    return null
  } catch {
    return null
  }
}

function getAllowedOrigin(): string | null {
  if (typeof process === 'undefined') return null
  const appUrl = process.env.APP_URL
  if (!appUrl) return null
  try {
    return new URL(appUrl).origin
  } catch {
    return null
  }
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false
  const allowed = getAllowedOrigin()
  if (!allowed) return true // skip check when APP_URL is not configured (e.g., tests)
  if (origin === allowed) return true
  // Allow localhost in non-production for DX
  if (process.env.APP_ENV !== 'production') {
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return true
    }
  }
  return false
}

type RouteHandler = (req: Request, ctx: { userId?: string }) => Promise<Response>

export function route(opts: {
  auth: 'public' | 'user'
  input?: z.ZodType<unknown>
}, handler: RouteHandler): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      // Origin check for state-mutating methods
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.get('origin')
        if (!isOriginAllowed(origin)) {
          return new Response(JSON.stringify({ ok: false, code: 'FORBIDDEN' }), {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'private, no-store',
            },
          })
        }
      }

      let userId: string | undefined

      if (opts.auth === 'user') {
        const id = await getSessionUserId()
        if (!id) {
          return new Response(JSON.stringify({ ok: false, code: 'FORBIDDEN' }), {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'private, no-store',
            },
          })
        }
        userId = id
      }

      const response = await handler(req, { userId })

      // Ensure Cache-Control is set on the response
      if (!response.headers.has('Cache-Control')) {
        const headers = new Headers(response.headers)
        headers.set('Cache-Control', 'private, no-store')
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }

      return response
    } catch (err) {
      if (err instanceof AppError) {
        return new Response(JSON.stringify({ ok: false, code: err.code }), {
          status: err.httpStatus,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-store',
          },
        })
      }
      logger.error('Unhandled route error', {
        err: err instanceof Error ? err.message : String(err),
      })
      return new Response(JSON.stringify({ ok: false, code: 'INTERNAL_ERROR' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-store',
        },
      })
    }
  }
}

// Re-export for convenience
export { ForbiddenError }
