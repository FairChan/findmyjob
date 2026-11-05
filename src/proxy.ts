import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSessionCookie } from 'better-auth/cookies'

const intlMiddleware = createMiddleware(routing)

// 只做「有没有会话 cookie」的乐观判断，真正的会话校验在页面和 action 里。
// 用 getSessionCookie 而不是写死 cookie 名：生产环境 useSecureCookies 会把名字变成 __Secure-better-auth.session_token
function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(getSessionCookie(request))
}

// Segments of the app that require authentication
const PROTECTED_SEGMENTS = ['s', 'e', 'admin'] as const

function isProtectedPage(pathname: string): boolean {
  for (const locale of routing.locales) {
    for (const seg of PROTECTED_SEGMENTS) {
      if (
        pathname === `/${locale}/${seg}` ||
        pathname.startsWith(`/${locale}/${seg}/`)
      ) {
        return true
      }
    }
  }
  // Also match without locale prefix — next-intl will redirect, but we guard anyway
  for (const seg of PROTECTED_SEGMENTS) {
    if (pathname === `/${seg}` || pathname.startsWith(`/${seg}/`)) {
      return true
    }
  }
  return false
}

function isProtectedApi(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false
  if (pathname.startsWith('/api/auth/')) return false
  if (pathname === '/api/health') return false
  return true
}

function extractLocale(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return locale
    }
  }
  return routing.defaultLocale
}

// 线 B（M7-T02）留下的钩子：已登录用户需要重新同意新版条款时，在这里重定向。
// 目前是桩函数，真正接入 needsReconsent(userId)（src/server/services/legal-consent.ts）记在 M1-T07 的遗留项里。
async function checkReconsent(
  _request: NextRequest,
): Promise<NextResponse | null> {
  return null
}

export default async function middleware(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') ?? randomUUID()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  const pathname = request.nextUrl.pathname

  // --- Protected API routes ---
  if (isProtectedApi(pathname)) {
    if (!hasSessionCookie(request)) {
      return new NextResponse(JSON.stringify({ ok: false, code: 'FORBIDDEN' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-store',
          'x-request-id': requestId,
        },
      })
    }
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    response.headers.set('x-request-id', requestId)
    return response
  }

  // --- API routes that are allowed without auth (auth/* and health) ---
  if (pathname.startsWith('/api/')) {
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    response.headers.set('x-request-id', requestId)
    return response
  }

  // --- Protected page routes: redirect to login if no session ---
  if (isProtectedPage(pathname)) {
    if (!hasSessionCookie(request)) {
      const locale = extractLocale(pathname)
      const loginUrl = new URL(`/${locale}/login`, request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  // --- All other page routes: re-consent check, then intl middleware ---
  const req = new NextRequest(request, { headers: requestHeaders })
  const reconsentRedirect = await checkReconsent(req)
  if (reconsentRedirect) {
    reconsentRedirect.headers.set('x-request-id', requestId)
    return reconsentRedirect
  }
  const response = intlMiddleware(req)
  response.headers.set('x-request-id', requestId)
  return response
}

export const config = {
  // Covers all non-static paths (pages + /api).
  // Excludes Next.js internals and paths with file extensions.
  matcher: ['/((?!_next|_vercel|.*\\..*).*)', '/api/:path*'],
}
