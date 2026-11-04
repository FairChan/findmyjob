import type { PgBoss } from 'pg-boss'
import type { Job } from 'pg-boss'
import { logger } from '../lib/logger'

export async function registerJobs(boss: PgBoss): Promise<void> {
  await boss.work('example', async (jobs: Job[]) => {
    for (const job of jobs) {
      logger.info({ jobId: job.id, name: job.name }, 'example job executed')
    }
  })

  logger.info('jobs registered')
}
