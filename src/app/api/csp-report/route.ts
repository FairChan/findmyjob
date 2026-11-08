import { z } from 'zod'
import { route } from '@/server/route'
import { logger } from '@/server/lib/logger'
import { checkRateLimit } from '@/server/lib/rate-limit'
import { getClientIp } from '@/server/lib/client-ip'

// Lenient schema — browsers send many optional fields; we only extract what we log.
const cspReportSchema = z.object({
  'csp-report': z
    .object({
      'violated-directive': z.string().optional(),
      'effective-directive': z.string().optional(),
      'blocked-uri': z.string().optional(),
    })
    .passthrough()
    .optional(),
}).passthrough()

function extractHost(uri: string | undefined): string | undefined {
  if (!uri) return undefined
  try {
    return new URL(uri).hostname
  } catch {
    // keyword like 'eval', 'inline', 'self', or empty
    return uri.slice(0, 64) || undefined
  }
}

export const POST = route({ auth: 'public' }, async (req) => {
  // Rate limit by IP — 120 reports / 1 min window
  const ip = getClientIp(req.headers) ?? 'unknown'
  const rl = await checkRateLimit(`csp-report:${ip}`, {
    windowMs: 60_000,
    limit: 120,
  })
  if (!rl.allowed) {
    return new Response(null, { status: 204 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(null, { status: 204 })
  }

  const parsed = cspReportSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(null, { status: 204 })
  }

  const report = parsed.data['csp-report']
  const directive =
    report?.['effective-directive'] ?? report?.['violated-directive']
  const blockedUriHost = extractHost(report?.['blocked-uri'])

  logger.warn({ directive, blockedUriHost }, 'csp-violation')

  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  })
})
