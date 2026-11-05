import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

const intlMiddleware = createMiddleware(routing)

// M1-T04 hook: after Better Auth is wired in, replace this stub with a real
// session check that redirects authenticated users who need to re-consent.
// See src/server/services/legal-consent.ts → needsReconsent(userId).
async function checkReconsent(
  _request: NextRequest,
): Promise<NextResponse | null> {
  return null
}

export default async function middleware(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') ?? randomUUID()

  // Forward requestId in request headers so downstream handlers can read it.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  const req = new NextRequest(request, { headers: requestHeaders })

  const reconsentRedirect = await checkReconsent(req)
  if (reconsentRedirect) {
    reconsentRedirect.headers.set('x-request-id', requestId)
    return reconsentRedirect
  }

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
