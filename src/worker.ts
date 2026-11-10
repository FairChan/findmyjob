import * as Sentry from '@sentry/node'
import { PgBoss } from 'pg-boss'
import { env } from '@/env'
import { logger } from '@/server/lib/logger'
import { createJobLifecycle, registerJobs } from '@/server/jobs/registry'
import { sentryOptions } from '@/lib/sentry-options'

Sentry.init(sentryOptions)

async function main() {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL
  const lifecycle = createJobLifecycle()

  const boss = new PgBoss({
    connectionString,
    max: 4,
    // pgboss schema 由 docker/postgres/db-setup.sql 预先建好并归 findmyjob_app；
    // 应用角色没有库级 CREATE 权限，CREATE SCHEMA IF NOT EXISTS 也会被拒（42501）
    createSchema: false,
  })

  boss.on('error', () => {
    logger.error({ code: 'PG_BOSS_ERROR' }, 'pg-boss error')
  })

  let startup: Promise<void> | undefined
  let stopping: Promise<void> | undefined
  function shutdown(signal: string, startupFailed = false): Promise<void> {
    if (stopping) return stopping
    const drained = lifecycle.stop()
    stopping = (async () => {
      // allSettled prevents a rejected/early boss stop from bypassing real child
      // close. Also wait for partial startup so it cannot register work after exit.
      const results = await Promise.allSettled([
        drained, Promise.resolve().then(() => boss.stop({ graceful: true })), startup,
      ])
      let failed = startupFailed || results.some(result => result.status === 'rejected')
      if (startupFailed) {
        Sentry.captureException(new Error('WORKER_STARTUP_FAILED'))
        logger.error({ code: 'WORKER_STARTUP_FAILED' }, 'worker startup failed')
      }
      if (failed) {
        Sentry.captureException(new Error('WORKER_SHUTDOWN_FAILED'))
        logger.error({ code: 'WORKER_SHUTDOWN_FAILED' }, 'worker shutdown failed')
      } else logger.info({ signal }, 'worker stopped')
      try { await Sentry.close(2000) } catch {
        failed = true
        logger.error({ code: 'WORKER_TELEMETRY_CLOSE_FAILED' }, 'worker telemetry close failed')
      }
      process.exit(failed ? 1 : 0)
    })()
    return stopping
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  startup = (async () => {
    await boss.start()
    if (lifecycle.signal.aborted) return
    logger.info('pg-boss started')
    await registerJobs(boss, lifecycle)
  })()
  try { await startup } catch {
    await shutdown('startup', true)
  }
}

main().catch(async () => {
  Sentry.captureException(new Error('WORKER_STARTUP_FAILED'))
  logger.error({ code: 'WORKER_STARTUP_FAILED' }, 'worker startup failed')
  try { await Sentry.close(2000) } catch { /* no work was admitted before startup setup failed */ }
  process.exit(1)
})
