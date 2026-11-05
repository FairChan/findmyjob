import 'server-only'
import { logger } from './logger'

/**
 * Fire-and-forget ping to a healthchecks.io endpoint after a job succeeds.
 * URL is read from HEALTHCHECKS_<JOB_NAME_UPPER> environment variable.
 * Example: HEALTHCHECKS_PRUNE_RATE_LIMIT=https://hc-ping.com/<uuid>
 */
export function pingHealthcheck(jobName: string): void {
  const envKey = `HEALTHCHECKS_${jobName.replace(/-/g, '_').toUpperCase()}`
  const url = process.env[envKey]
  if (!url) return

  void fetch(url, { signal: AbortSignal.timeout(5000) }).catch((err: unknown) => {
    logger.warn({ err, jobName }, 'healthchecks ping failed')
  })
}
