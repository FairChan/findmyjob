/**
 * Shared Prisma client for Playwright E2E test workers.
 *
 * Convention:
 *  - Every E2E run spawns its own dev server via `playwright.config.ts`.
 *  - Lane B uses port 3001; mainline uses port 3000. The two never share a server.
 *  - `reuseExistingServer` is false: if port 3001 is already in use (e.g. a manual
 *    `pnpm dev` session), Playwright will fail to start. Stop the dev server first.
 *  - `TEST_DATABASE_URL` must point to a local *_test database; the config reads it
 *    from .env if not already in the process environment. DATABASE_URL is NOT used as
 *    a fallback — that would silently write to the development database.
 *
 * Why random passwords in loginAs (see session.ts):
 *  Fixed passwords are a persistent credential that outlive the test run. A fixed
 *  password combined with a real email pattern means any account written to the dev
 *  database (before this fix) is reachable with a known credential. Randomising
 *  per-user prevents that even if stale accounts remain.
 */
import { PrismaClient } from '@prisma/client'
import { validateTestDbUrl } from '../../lib/validate-test-db-url'

type Env = { TEST_DATABASE_URL?: string; APP_ENV?: string }

function guardProductionEnv(env: Env): void {
  const appEnv = env.APP_ENV ?? (process.env.APP_ENV as string | undefined)
  if (appEnv === 'production' || appEnv === 'staging') {
    throw new Error(
      `[e2e-db] Refusing to create an E2E DB client in APP_ENV=${appEnv}. ` +
        'E2E tests must only run against a local test database.',
    )
  }
}

/** Exported for unit-testing the guard logic with injected env. */
export function createE2eDb(env: Env = process.env as Env): PrismaClient {
  guardProductionEnv(env)
  const url = validateTestDbUrl(env.TEST_DATABASE_URL)
  return new PrismaClient({ datasources: { db: { url } }, log: [] })
}

/**
 * Singleton E2E DB client. All spec files should import this instead of
 * constructing their own `new PrismaClient()`.
 */
export const e2eDb = createE2eDb()
