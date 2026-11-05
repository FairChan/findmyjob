import * as Sentry from '@sentry/node'
import { PgBoss } from 'pg-boss'
import { env } from '@/env'
import { logger } from '@/server/lib/logger'
import { registerJobs } from '@/server/jobs/registry'
import { sentryOptions } from '@/lib/sentry-options'

Sentry.init(sentryOptions)

async function main() {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL

  const boss = new PgBoss({
    connectionString,
    max: 4,
    // pgboss schema 由 docker/postgres/db-setup.sql 预先建好并归 findmyjob_app；
    // 应用角色没有库级 CREATE 权限，CREATE SCHEMA IF NOT EXISTS 也会被拒（42501）
    createSchema: false,
  })

  boss.on('error', (err: unknown) => logger.error({ err }, 'pg-boss error'))

  await boss.start()
  logger.info('pg-boss started')

  await registerJobs(boss)

  let stopping = false

  async function shutdown(signal: string): Promise<void> {
    if (stopping) return
    stopping = true
    logger.info({ signal }, 'worker shutting down')
    await boss.stop({ graceful: true })
    logger.info('worker stopped')
    process.exit(0)
  }

  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err: unknown) => {
  logger.error({ err }, 'worker startup failed')
  process.exit(1)
})
