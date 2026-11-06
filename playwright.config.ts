import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Bootstrap TEST_DATABASE_URL from .env when not already in the shell environment (local dev).
// CI exports this via the environment; local dev relies on .env.
if (!process.env.TEST_DATABASE_URL) {
  try {
    const env = readFileSync(resolve(__dirname, '.env'), 'utf-8')
    for (const line of env.split('\n')) {
      const eq = line.indexOf('=')
      if (eq <= 0 || line.trimStart().startsWith('#')) continue
      const k = line.slice(0, eq).trim()
      let v = line.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (k && !(k in process.env)) process.env[k] = v
    }
  } catch {}
}

// 并行车道（git worktree）设 PORT 换端口：reuseExistingServer 否则会连上另一条车道已经起着的 dev server
const port = Number(process.env.PORT) || 3000
const baseURL = `http://localhost:${port}`

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    // Auth setup: runs once, logs in and writes storageState files
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Main chromium tests depend on setup so storageState is ready
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // E2E tests run entirely against the test database; propagate TEST_DATABASE_URL as DATABASE_URL
    env: process.env.TEST_DATABASE_URL
      ? { DATABASE_URL: process.env.TEST_DATABASE_URL }
      : undefined,
  },
})
