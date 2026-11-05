import 'server-only'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { AppError, ForbiddenError } from './errors'
import { logger } from './lib/logger'
import type { CompanyMemberRole } from '@prisma/client'
import type { AuthOption, CompanyAuthOpt } from './action'

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

async function resolveRouteAuth(
  auth: AuthOption,
  req: Request,
): Promise<{ userId?: string; companyId?: string; companyRole?: CompanyMemberRole }> {
  if (auth === 'public') return {}

  const h = req.headers as unknown as Headers

  if (auth === 'user') {
    const { requireUser } = await import('./authz')
    return await requireUser(h)
  }

  if (auth === 'student') {
    const { requireStudent } = await import('./authz')
    return await requireStudent(h)
  }

  if (auth === 'admin') {
    const { requireAdmin } = await import('./authz')
    return await requireAdmin(h)
  }

  const opt: CompanyAuthOpt =
    auth === 'company' ? { type: 'company' } : (auth as CompanyAuthOpt)
  const minRole: CompanyMemberRole = opt.minRole ?? 'RECRUITER'

  if (opt.verified) {
    const { requireVerifiedCompany } = await import('./authz')
    const ctx = await requireVerifiedCompany(minRole, h)
    return { userId: ctx.userId, companyId: ctx.companyId, companyRole: ctx.role }
  }

  const { requireCompanyMember } = await import('./authz')
  const ctx = await requireCompanyMember(minRole, h)
  return { userId: ctx.userId, companyId: ctx.companyId, companyRole: ctx.role }
}

type RouteHandler = (
  req: Request,
  ctx: { userId?: string; companyId?: string; companyRole?: CompanyMemberRole },
) => Promise<Response>

export function route(
  opts: {
    auth: AuthOption
    input?: z.ZodType<unknown>
  },
  handler: RouteHandler,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = req.headers.get('x-request-id') ?? randomUUID()
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

      let authCtx: { userId?: string; companyId?: string; companyRole?: CompanyMemberRole }
      try {
        authCtx = await resolveRouteAuth(opts.auth, req)
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
        throw err
      }

      const response = await handler(req, authCtx)

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
      logger.error(
        {
          requestId,
          err: err instanceof Error ? err.message : String(err),
        },
        'Unhandled route error',
      )
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
