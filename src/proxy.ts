import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSessionCookie } from 'better-auth/cookies'

// Fixed loopback address for the internal reconsent check.
// Never derive this from the incoming Host/X-Forwarded-Host headers — that would
// allow an attacker to redirect the session cookie to an arbitrary host.
// Defaults to this process's own PORT, so a dev server on :3001 never calls another one on :3000;
// set INTERNAL_BASE_URL only when the app is reachable on a different loopback address.
// The direct loopback connection bypasses Caddy's basic_auth (DECISIONS A22).
const INTERNAL_BASE_URL =
  process.env.INTERNAL_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`

const intlMiddleware = createMiddleware(routing)

// 只做「有没有会话 cookie」的乐观判断，真正的会话校验在页面和 action 里。
// 用 getSessionCookie 而不是写死 cookie 名：生产环境 useSecureCookies 会把名字变成 __Secure-better-auth.session_token
function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(getSessionCookie(request))
}

// Segments of the app that require authentication
const PROTECTED_SEGMENTS = ['s', 'e', 'admin'] as const

// URL path slugs for auth-related pages (no-index, private)
const AUTH_PAGE_SLUGS = [
  'login',
  'register',
  'verify-email',
  'reset-password',
  'forgot-password',
  'legal/reconsent',
] as const

function requiresNoIndex(pathname: string): boolean {
  for (const locale of routing.locales) {
    // Protected app sections: /s, /e, /admin
    for (const seg of PROTECTED_SEGMENTS) {
      if (
        pathname === `/${locale}/${seg}` ||
        pathname.startsWith(`/${locale}/${seg}/`)
      ) {
        return true
      }
    }
    // Auth pages
    for (const slug of AUTH_PAGE_SLUGS) {
      if (
        pathname === `/${locale}/${slug}` ||
        pathname.startsWith(`/${locale}/${slug}/`)
      ) {
        return true
      }
    }
  }
  // Also match without locale prefix
  for (const seg of PROTECTED_SEGMENTS) {
    if (pathname === `/${seg}` || pathname.startsWith(`/${seg}/`)) {
      return true
    }
  }
  for (const slug of AUTH_PAGE_SLUGS) {
    if (pathname === `/${slug}` || pathname.startsWith(`/${slug}/`)) {
      return true
    }
  }
  return false
}

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

// 已登录用户需要重新同意新版条款时，在这里重定向。
// 通过内部 API 端点检查（Prisma 不能在 Edge/Middleware 里直接用），
// 失败时 fail-open（不阻塞用户），以防止内部错误或服务暂时不可用。
async function checkReconsent(
  request: NextRequest,
): Promise<NextResponse | null> {
  if (!hasSessionCookie(request)) return null

  const pathname = request.nextUrl.pathname
  // Don't redirect away from the reconsent page itself
  if (pathname.includes('/legal/reconsent')) return null

  try {
    const checkUrl = new URL('/api/internal/needs-reconsent', INTERNAL_BASE_URL)
    const res = await fetch(checkUrl.toString(), {
      headers: {
        cookie: request.headers.get('cookie') ?? '',
        'x-real-ip': request.headers.get('x-real-ip') ?? '',
        'user-agent': request.headers.get('user-agent') ?? '',
        origin: request.nextUrl.origin,
      },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json() as { needsReconsent?: boolean }
    if (!data.needsReconsent) return null

    const locale = extractLocale(pathname)
    const reconsentUrl = new URL(`/${locale}/legal/reconsent`, request.url)
    return NextResponse.redirect(reconsentUrl)
  } catch {
    // Fail open: a transient error must not lock users out
    return null
  }
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
          'X-Robots-Tag': 'noindex, nofollow',
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

  // --- All other page routes: re-consent check (page navigations only), then intl middleware ---
  const req = new NextRequest(request, { headers: requestHeaders })
  // Server Actions arrive as POST + Next-Action header; they cannot handle a 3xx redirect —
  // the browser surfaces "网络连接出错" instead of following it. Skip reconsent for those;
  // the user will be redirected on their next full page navigation.
  // RSC client navigations (GET + RSC:1) are real navigations — Next 16.4.5 follows the
  // redirect and renders the destination, so we let them through the check.
  const isPageNavigation =
    (request.method === 'GET' || request.method === 'HEAD') &&
    !request.headers.has('Next-Action')
  if (isPageNavigation) {
    const reconsentRedirect = await checkReconsent(req)
    if (reconsentRedirect) {
      reconsentRedirect.headers.set('x-request-id', requestId)
      return reconsentRedirect
    }
  }
  const response = intlMiddleware(req)
  response.headers.set('x-request-id', requestId)

  // Protected pages (student, employer, admin) and auth pages: prevent caching and indexing.
  if (requiresNoIndex(pathname)) {
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }

  return response
}

export const config = {
  // Covers all non-static paths (pages + /api).
  // Excludes Next.js internals and paths with file extensions.
  matcher: ['/((?!_next|_vercel|.*\\..*).*)', '/api/:path*'],
}
