import 'server-only'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { AppError, ForbiddenError } from './errors'
import { logger } from './lib/logger'
import { isAppOriginRequest } from './lib/app-origin'
import { runAsRequestClient } from './lib/request-client'
import { APP_VERSION_HEADER, compareAppVersions } from '@/shared/mobile-api'
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

  if (auth === 'admin' || auth === 'admin-fresh') {
    const { requireAdmin } = await import('./authz')
    return await requireAdmin(h, { fresh: auth === 'admin-fresh' })
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

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ ok: false, code }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

// A missing or malformed version header compares below every real version, so an app that
// forgets the header is told to update instead of slipping past the gate.
async function isAppVersionTooOld(version: string | null): Promise<boolean> {
  const { getSetting } = await import('./services/settings')
  const min = await getSetting<string>('mobile.minSupportedVersion', '0.0.0')
  return compareAppVersions(version ?? '', min) < 0
}

type RouteHandler = (
  req: Request,
  ctx: { userId?: string; companyId?: string; companyRole?: CompanyMemberRole; input?: unknown },
) => Promise<Response>

export function route(
  opts: {
    auth: AuthOption
    input?: z.ZodType<unknown>
    /**
     * Only honoured with auth 'public': browser report sinks and server webhooks
     * that authenticate the original body themselves before changing any state.
     */
    skipOriginCheck?: boolean
    /**
     * Who may call this route (MA1-T01). 'web' (default): the site's own origin, as before.
     * 'app': only the Android app — exact MOBILE_APP_ORIGINS match for every method, plus the
     * mobile.minSupportedVersion gate; used by /api/m/v1. 'web+app': either, for endpoints both
     * clients share (uploads). Browsers cannot forge Origin, so this is the app's CSRF boundary.
     */
    origin?: 'web' | 'app' | 'web+app'
    /**
     * MA1-T07，只对 origin 'app' 生效：已登录用户没有同意当前版本的条款和隐私政策时，
     * 返回 409 NEEDS_RECONSENT（Web 由 proxy.ts 在页面导航时重定向，App 没有这一层）。
     * 'exempt' 用于数据权利、隐私撤回、注销和同意本身，与 proxy.ts 对 /s/privacy 的豁免一致。
     * 'web' 和 'web+app' 路由不受影响。
     */
    reconsent?: 'enforce' | 'exempt'
  },
  handler: RouteHandler,
): (req: Request) => Promise<Response> {
  const skipOrigin = opts.skipOriginCheck === true && opts.auth === 'public'
  const originMode = opts.origin ?? 'web'
  return async (req: Request): Promise<Response> => {
    const requestId = req.headers.get('x-request-id') ?? randomUUID()
    try {
      const fromApp = originMode !== 'web' && isAppOriginRequest(req.headers)
      if (originMode === 'app' && !fromApp) {
        return jsonError(403, 'FORBIDDEN')
      }
      if (fromApp) {
        const tooOld = await isAppVersionTooOld(req.headers.get(APP_VERSION_HEADER))
        if (tooOld) return jsonError(426, 'APP_UPDATE_REQUIRED')
      }

      // Origin check for state-mutating methods
      if (!fromApp && !skipOrigin && req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.get('origin')
        if (!isOriginAllowed(origin)) {
          return new Response(JSON.stringify({ ok: false, code: 'FORBIDDEN' }), {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'private, no-store',
              'X-Robots-Tag': 'noindex, nofollow',
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
              'X-Robots-Tag': 'noindex, nofollow',
            },
          })
        }
        throw err
      }

      // 先鉴权再查同意：匿名或角色不对的请求照旧 401/403，不泄露"这个账号要不要重新同意"
      if (originMode === 'app' && opts.reconsent !== 'exempt' && authCtx.userId) {
        const { needsReconsent } = await import('./services/legal-consent')
        if (await needsReconsent(authCtx.userId)) return jsonError(409, 'NEEDS_RECONSENT')
      }

      // Note: route handlers that need raw body (e.g. webhook signature verification)
      // should not pass an input schema and read the body themselves.
      let parsedInput: unknown = undefined
      if (opts.input) {
        let raw: unknown
        if (req.method === 'GET' || req.method === 'HEAD') {
          const url = new URL(req.url)
          raw = Object.fromEntries(url.searchParams.entries())
        } else {
          try {
            raw = await req.json()
          } catch {
            return new Response(JSON.stringify({ ok: false, code: 'INVALID_JSON' }), {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'private, no-store',
                'X-Robots-Tag': 'noindex, nofollow',
              },
            })
          }
        }
        const result = opts.input.safeParse(raw)
        if (!result.success) {
          return new Response(JSON.stringify({ ok: false, code: 'VALIDATION_ERROR' }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'private, no-store',
              'X-Robots-Tag': 'noindex, nofollow',
            },
          })
        }
        parsedInput = result.data
      }

      const handlerCtx = { ...authCtx, input: parsedInput }
      // 只有通过了精确 App origin 校验的请求才打上来源标记，供审计 metadata 记 client: 'android'
      const response = fromApp
        ? await runAsRequestClient('android', () => handler(req, handlerCtx))
        : await handler(req, handlerCtx)

      // Ensure Cache-Control and X-Robots-Tag are set for all /api responses.
      // partner-logos sets its own Cache-Control (public, max-age=86400) so only
      // X-Robots-Tag is added there; no-store is added when no Cache-Control is present.
      const needsCacheControl = !response.headers.has('Cache-Control')
      const needsRobotsTag = !response.headers.has('X-Robots-Tag')
      if (needsCacheControl || needsRobotsTag) {
        const headers = new Headers(response.headers)
        if (needsCacheControl) headers.set('Cache-Control', 'private, no-store')
        if (needsRobotsTag) headers.set('X-Robots-Tag', 'noindex, nofollow')
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
            'X-Robots-Tag': 'noindex, nofollow',
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
          'X-Robots-Tag': 'noindex, nofollow',
        },
      })
    }
  }
}

// Re-export for convenience
export { ForbiddenError }
