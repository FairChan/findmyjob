export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { init } = await import('@sentry/nextjs')
    const { sentryOptions } = await import('./lib/sentry-options')
    init(sentryOptions)
    // One structured line per boot: ops can see restarts, and the E2E PII log check
    // (tests/e2e/global-teardown.ts) can prove app logger output reached the collected log
    // even when a green run hits no error path.
    const { logger } = await import('./server/lib/logger')
    logger.info({ event: 'server.start' }, 'server started')
  }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routeType: string; routePath: string },
) {
  const { captureRequestError } = await import('@sentry/nextjs')
  // Prefer routePath (the route template, e.g. /s/[studentId]) over the actual path
  // so Sentry never receives real IDs or tokens in the request URL.
  captureRequestError(err, { ...request, path: context.routePath ?? request.path }, context)
}
