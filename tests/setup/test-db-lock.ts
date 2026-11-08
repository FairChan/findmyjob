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

// Prisma recycles a pooled connection that has been idle longer than max_idle_connection_lifetime
// (300 s by default) the next time it is used, and a session-level advisory lock dies with that
// connection. A full run takes ~16 minutes, and one lane B full run (2026-11-08, 952 s) did find the
// lock already gone. Re-asserting the lock on the same client well inside that window keeps the
// connection from ever counting as idle, and re-takes the lock if the session was ever swapped.
const HEARTBEAT_MS = 30_000

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

  const heartbeat = setInterval(() => {
    client.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_lock(${TEST_DB_LOCK_KEY}) AS locked`
      .then((r) => {
        if (!r[0]?.locked) console.error(`[test-db-lock] lost the lock on ${dbName} to another run`)
      })
      .catch(() => {})
  }, HEARTBEAT_MS)
  heartbeat.unref()

  return {
    dbName,
    release: async () => {
      clearInterval(heartbeat)
      try {
        // Each heartbeat re-acquire stacks one more hold on the same session; drop them all.
        // pg_advisory_unlock_all() returns void, which $queryRaw cannot deserialize.
        await client.$executeRaw`SELECT pg_advisory_unlock_all()`
      } finally {
        await client.$disconnect()
      }
    },
  }
}
