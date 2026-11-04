import 'server-only'
import { PgBoss } from 'pg-boss'
import { env } from '@/env'

function createSendBoss(): PgBoss {
  return new PgBoss({
    connectionString: env.WORKER_DATABASE_URL ?? env.DATABASE_URL,
    max: 2,
    supervise: false,
    schedule: false,
  })
}

const globalForBoss = globalThis as unknown as { sendBoss?: PgBoss }

export const sendBoss: PgBoss = globalForBoss.sendBoss ?? createSendBoss()

if (env.APP_ENV !== 'production') globalForBoss.sendBoss = sendBoss
