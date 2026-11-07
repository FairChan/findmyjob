/**
 * Mutual exclusion for the integration-test database.
 *
 * Why: integration tests TRUNCATE every table before each test. Two `vitest run` processes on the
 * same *_test database wipe each other's rows and fail with random FK errors (this happened when an
 * unattended round left several background vitest runs behind). The first run takes a session-level
 * advisory lock on a dedicated single-connection client and holds it until teardown; any other run
 * on the same database fails within seconds with a clear message instead of corrupting the first.
 * Lane A and lane B use different test databases, so they never block each other.
 */
import { PrismaClient } from '@prisma/client'
import { validateTestDbUrl } from '../lib/validate-test-db-url'

// Single-bigint advisory key. lockXact uses the two-int4 form, which PostgreSQL keeps in a
// separate key space, so this cannot collide with any LOCK_NS namespace.
export const TEST_DB_LOCK_KEY = 7301946001n

export interface TestDbLock {
  dbName: string
  release: () => Promise<void>
}

function singleConnectionUrl(url: string): string {
  const u = new URL(url)
  u.searchParams.set('connection_limit', '1')
  return u.toString()
}

export function testDbLockBusyMessage(dbName: string): string {
  return `[test-db-lock] another vitest run is using ${dbName}; wait for it to finish, do not start another`
}

export async function acquireTestDbLock(rawUrl: string | undefined): Promise<TestDbLock> {
  const url = validateTestDbUrl(rawUrl)
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
  const client = new PrismaClient({ datasources: { db: { url: singleConnectionUrl(url) } }, log: [] })

  const rows = await client.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(${TEST_DB_LOCK_KEY}) AS locked`
  if (!rows[0]?.locked) {
    await client.$disconnect()
    throw new Error(testDbLockBusyMessage(dbName))
  }

  return {
    dbName,
    release: async () => {
      try {
        await client.$queryRaw`SELECT pg_advisory_unlock(${TEST_DB_LOCK_KEY})`
      } finally {
        await client.$disconnect()
      }
    },
  }
}
