export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { init } = await import('@sentry/nextjs')
    const { sentryOptions } = await import('./lib/sentry-options')
    init(sentryOptions)
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
