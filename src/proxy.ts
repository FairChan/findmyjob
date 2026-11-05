import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'

const intlMiddleware = createMiddleware(routing)

export default function middleware(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') ?? randomUUID()

  // Forward requestId in request headers so downstream handlers can read it.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  const req = new NextRequest(request, { headers: requestHeaders })
  const response = intlMiddleware(req)

  // Echo requestId in response headers for clients / tracing.
  response.headers.set('x-request-id', requestId)
  return response
}

export const config = {
  matcher: [
    // Match all pathnames except files with extensions, _next, and api
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
}
