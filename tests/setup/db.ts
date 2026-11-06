/**
 * Integration-test DB helpers.
 *
 * Safety contract: this module throws at import time if the connected database
 * does not look like a test database, preventing accidental writes to production.
 *
 * Usage in integration tests:
 *   import { setupTestDb, testDb } from '../setup/db'
 *   setupTestDb()   // registers beforeEach (truncate) and afterAll (disconnect)
 */
import { beforeEach, afterAll } from 'vitest'
import { Prisma, PrismaClient } from '@prisma/client'
import { validateTestDbUrl as _validateTestDbUrl } from '../lib/validate-test-db-url'

// Re-export so mainline M4-T15 and other callers can import from this module.
export { validateTestDbUrl } from '../lib/validate-test-db-url'

// ---- Safety guard (runs at import time, before any test) ----------------

// Falls back to DATABASE_URL so plain `pnpm test` still works when only
// DATABASE_URL points at a *_test DB (e.g. in some CI setups).
_validateTestDbUrl(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL
if (!adminUrl) {
  throw new Error(
    '[db-setup] TEST_ADMIN_DATABASE_URL is required for integration tests (owner role, for TRUNCATE)'
  )
}

// ---- Clients ------------------------------------------------------------

/** Owner-role client used exclusively for pre-test table truncation. */
const adminClient = new PrismaClient({
  datasources: { db: { url: adminUrl } },
  log: [],
})

/** App-role client for use in tested code (matches findmyjob_app permissions). */
export const testDb = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
  log: [],
})

// ---- Cleanup ------------------------------------------------------------

async function truncateAllTables(): Promise<void> {
  // Retrieve all public tables except _prisma_migrations from the system catalog
  const rows = await adminClient.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename != '_prisma_migrations'
    ORDER BY tablename
  `
  if (rows.length === 0) return

  // Table names come from pg_tables (trusted system catalog, not user input).
  // Prisma.raw is the documented way to inject identifiers into sql templates.
  const tableFragments = rows.map((r) => Prisma.raw(`"${r.tablename}"`))
  const tableList = Prisma.join(tableFragments, ', ')
  await adminClient.$executeRaw(
    Prisma.sql`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`
  )
}

/**
 * Call at the top of each integration test file.
 * Registers beforeEach (truncate all tables) and afterAll (disconnect clients).
 */
export function setupTestDb(): void {
  beforeEach(async () => {
    await truncateAllTables()
  })

  afterAll(async () => {
    await Promise.all([adminClient.$disconnect(), testDb.$disconnect()])
  })
}
