import type { PgBoss } from 'pg-boss'
import type { Job } from 'pg-boss'
import { logger } from '../lib/logger'
import { runPurgeUnverified } from './purge-unverified'

export async function registerJobs(boss: PgBoss): Promise<void> {
  // pg-boss 10 起 work() 之前必须先有队列，否则轮询时报 PGBOSS_QUEUE_NOT_FOUND
  await boss.createQueue('example')
  await boss.work('example', async (jobs: Job[]) => {
    for (const job of jobs) {
      logger.info({ jobId: job.id, name: job.name }, 'example job executed')
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
