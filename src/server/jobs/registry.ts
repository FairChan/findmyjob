import * as Sentry from '@sentry/node'
import { Prisma } from '@prisma/client'
import type { PgBoss } from 'pg-boss'
import type { Job } from 'pg-boss'
import { db } from '../db'
import { logger } from '../lib/logger'
import { runPurgeUnverified } from './purge-unverified'
import { pingHealthcheck } from '../lib/healthchecks'

export async function registerJobs(boss: PgBoss): Promise<void> {
  // ── example ──────────────────────────────────────────────────────────────
  await boss.createQueue('example')
  await boss.work('example', async (jobs: Job[]) => {
    try {
      for (const job of jobs) {
        logger.info({ jobId: job.id, name: job.name }, 'example job executed')
      }
      pingHealthcheck('example')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  // ── prune-rate-limit ──────────────────────────────────────────────────────
  // Deletes expired RateLimitBucket rows (windowEnd < now()); runs hourly.
  await boss.createQueue('prune-rate-limit')
  await boss.schedule('prune-rate-limit', '0 * * * *', {})
  await boss.work('prune-rate-limit', async () => {
    try {
      const result = await db.$executeRaw(
        Prisma.sql`DELETE FROM "RateLimitBucket" WHERE "windowEnd" < now()`,
      )
      logger.info({ deleted: result }, 'prune-rate-limit completed')
      pingHealthcheck('prune-rate-limit')
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  })

  await boss.createQueue('purge-unverified')
  // Run every hour to remove student accounts that have not verified their email
  // within signup.unverifiedTtlHours (default 48h)
  await boss.schedule('purge-unverified', '0 * * * *', {})
  await boss.work('purge-unverified', async () => {
    await runPurgeUnverified()
  })

  logger.info('jobs registered')
}
