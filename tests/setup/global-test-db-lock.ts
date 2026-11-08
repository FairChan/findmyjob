/**
 * Vitest globalSetup: holds the test-database lock for the whole run (see test-db-lock.ts).
 * Without a database URL (pure unit runs) there is nothing to protect, so it does nothing.
 */
import { acquireTestDbLock } from './test-db-lock'

export default async function setup(): Promise<(() => Promise<void>) | void> {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) return
  const lock = await acquireTestDbLock(url)
  return async () => {
    await lock.release()
  }
}
