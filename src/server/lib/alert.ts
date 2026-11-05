import 'server-only'
import * as Sentry from '@sentry/nextjs'
import { logger } from './logger'

// M3-T03: also createNotification for ADMIN
export function alert(code: string, ctx?: Record<string, unknown>): void {
  logger.error({ alert: code, ...ctx }, `alert: ${code}`)
  Sentry.captureMessage(`alert: ${code}`, {
    level: 'error',
    extra: ctx,
    tags: { alertCode: code },
  })
}
