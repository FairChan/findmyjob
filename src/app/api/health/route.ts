import { db } from '@/server/db'
import { route } from '@/server/route'

export const GET = route({ auth: 'public' }, async () => {
  const version = process.env.APP_TAG ?? 'unknown'

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('health check DB timeout')), 2000),
    )
    await Promise.race([db.$queryRaw`SELECT 1`, timeout])
  } catch {
    return Response.json(
      { status: 'error', version },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  return Response.json(
    { status: 'ok', version },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
