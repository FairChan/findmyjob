import { describe, it, expect } from 'vitest'
import { acquireTestDbLock, testDbLockBusyMessage } from '../setup/test-db-lock'

// This file runs inside a vitest run whose globalSetup already holds the test-database lock
// (tests/setup/global-test-db-lock.ts). A second run on the same database must be refused fast,
// instead of TRUNCATE-ing the first run's rows.
describe('test database lock', () => {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  const dbName = url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) : ''

  it('a second run on the same test database is refused with a clear message', async () => {
    const started = Date.now()
    await expect(acquireTestDbLock(url)).rejects.toThrow(testDbLockBusyMessage(dbName))
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('the busy message names the database and tells the caller not to start another run', () => {
    expect(testDbLockBusyMessage(dbName)).toContain(dbName)
    expect(testDbLockBusyMessage(dbName)).toContain('do not start another')
  })
})
