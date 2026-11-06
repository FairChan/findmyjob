import 'server-only'
import * as Sentry from '@sentry/nextjs'
import { logger } from './logger'

// M7-T04: also forward to Sentry severity-error
export function alert(code: string, ctx?: Record<string, unknown>): void {
  logger.error({ alert: code, ...ctx }, `alert: ${code}`)
  Sentry.captureMessage(`alert: ${code}`, {
    level: 'error',
    extra: ctx,
    tags: { alertCode: code },
  })
  // M3-T03: notify all ADMIN users in-app (fire-and-forget)
  void notifyAdmins(code, ctx)
}

async function notifyAdmins(code: string, ctx?: Record<string, unknown>): Promise<void> {
  try {
    const { db } = await import('../db')
    const { createNotification } = await import('../services/notifications')
    const admins = await db.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    })
    await Promise.all(
      admins.map(a => createNotification(db, a.id, 'system.alert', { code, ...ctx })),
    )
  } catch (err) {
    logger.error({ err, alertCode: code }, 'failed to notify admins of alert')
  }
}
