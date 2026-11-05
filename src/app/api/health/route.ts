import { db } from '@/server/db'
import { route } from '@/server/route'

export const GET = route({ auth: 'public' }, async () => {
  const version = process.env.APP_TAG ?? 'unknown'

  let timerId: ReturnType<typeof setTimeout> | undefined
  try {
    const dbPromise = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2s'`
        await tx.$queryRaw`SELECT 1`
      },
      { maxWait: 500, timeout: 2500 },
    )
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error('health check timeout')), 2000)
    })
    await Promise.race([dbPromise, timeoutPromise])
  } catch {
    return Response.json(
      { status: 'error', version },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  } finally {
    clearTimeout(timerId)
  }

  return Response.json(
    { status: 'ok', version },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
