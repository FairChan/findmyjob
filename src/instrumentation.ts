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
  captureRequestError(err, request, context)
}
