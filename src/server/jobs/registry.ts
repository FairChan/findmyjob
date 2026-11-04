import type { PgBoss } from 'pg-boss'
import type { Job } from 'pg-boss'
import { logger } from '../lib/logger'

export async function registerJobs(boss: PgBoss): Promise<void> {
  // pg-boss 10 起 work() 之前必须先有队列，否则轮询时报 PGBOSS_QUEUE_NOT_FOUND
  await boss.createQueue('example')
  await boss.work('example', async (jobs: Job[]) => {
    for (const job of jobs) {
      logger.info({ jobId: job.id, name: job.name }, 'example job executed')
    }
  })

  logger.info('jobs registered')
}
