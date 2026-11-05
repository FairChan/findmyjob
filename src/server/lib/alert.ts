import 'server-only'
import { logger } from './logger'

// M0: only logger.error (level 50)
// M3-T03: also createNotification for ADMIN
// M7-T04: also forward to Sentry
export function alert(code: string, ctx?: Record<string, unknown>): void {
  logger.error({ alert: code, ...ctx }, `alert: ${code}`)
}
