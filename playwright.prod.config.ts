/**
 * Playwright config for security-headers E2E tests run against a real production build.
 *
 * Usage:
 *   pnpm build && pnpm exec playwright test -c playwright.prod.config.ts --workers=1
 * Or via the package.json shortcut:
 *   pnpm test:e2e:prod
 *
 * Unlike the dev-server config, this starts `next start` on port 3011 so both lanes can run simultaneously.
 * No global-setup / global-teardown: these tests only check response headers, not test-database state.
 */
import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'fs'
import { parseEnv } from 'util'
import { validateTestDbUrl } from './tests/lib/validate-test-db-url'

let testDatabaseUrl: string
if (process.env.TEST_DATABASE_URL) {
  testDatabaseUrl = process.env.TEST_DATABASE_URL
} else {
  try {
    const envContent = readFileSync('.env', 'utf8')
    const parsed = parseEnv(envContent)
    if (!parsed.TEST_DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL not found in .env')
    }
    testDatabaseUrl = parsed.TEST_DATABASE_URL
    process.env.TEST_DATABASE_URL = testDatabaseUrl
  } catch (err) {
    throw new Error(
      `[playwright.prod.config] Cannot resolve TEST_DATABASE_URL: ${(err as Error).message}`,
    )
  }
}

validateTestDbUrl(testDatabaseUrl)

const PROD_PORT = 3011

export default defineConfig({
  testMatch: ['**/security-headers.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PROD_PORT}`,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm start --port ${PROD_PORT}`,
    url: `http://localhost:${PROD_PORT}/api/health`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DATABASE_URL: testDatabaseUrl,
      APP_ENV: 'ci',
      PORT: String(PROD_PORT),
      PROD_BASE_URL: `http://localhost:${PROD_PORT}`,
    },
    timeout: 60_000,
  },
})
